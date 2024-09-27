// *****************************************************************************
// Copyright (C) 2023-2024 STMicroelectronics.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: MIT License which is
// available at https://opensource.org/licenses/MIT.
//
// SPDX-License-Identifier: EPL-2.0 OR MIT
// *****************************************************************************

import { ModelAccessorBus } from '@eclipse-emfcloud/model-accessor-bus';
import {
  ChangeSubscription,
  CommandStack,
  CoreCommandStackSubscription,
  DirtyStateChangedCallback,
  ModelManager,
} from '@eclipse-emfcloud/model-manager';
import {
  Diagnostic,
  ModelValidationService,
  merge,
} from '@eclipse-emfcloud/model-validation';
import { Operation } from 'fast-json-patch';
import { pull } from 'lodash';
import {
  ModelHub,
  ModelHubSubscription,
  ModelPersistenceContribution,
  ModelServiceContribution,
} from '../api';
import { HubAwareProvider } from './hub-aware-accessor-provider';
import { ModelManagerSubscription } from './model-service-model-manager';
import { ModelTriggerEngine } from './model-trigger-engine';

export class ModelHubImpl<K = string, C = unknown> implements ModelHub<K, C> {
  private contributions = new Map<string, ModelServiceContribution<K>>();
  private subscriptions: SubscriptionEntry<K>[] = [];

  private selfSubscription: ModelHubSubscription<K>;
  private modelManagerSubscription: ModelManagerSubscription<K>;
  private liveValidationSubscription: ChangeSubscription<K> | undefined;
  private dirtyStateSub: CoreCommandStackSubscription<K>;

  // The core command stack tracks dirty state per editing context, but we track
  // it per model ID, so we have to aggregate each editing context's state per model ID.
  // Key is model ID; value is editing contexts (command stack IDs) in which it is dirty
  private dirtyState = new Map<K, Set<string>>();

  private pendingLoads = new Map<K, Promise<object>>();

  private disposed = false;

  constructor(
    public context: C,
    private modelManager: ModelManager<K>,
    private validationService: ModelValidationService<K>,
    private modelAccessorBus: ModelAccessorBus
  ) {
    this.selfSubscription = this.subscribe();
    this.selfSubscription.onModelLoaded = this.handleModelLoaded.bind(this);
    this.liveValidation = true;

    this.dirtyStateSub = modelManager
      .getCommandStack('')
      .getCoreCommandStack()
      .subscribe();
    this.dirtyStateSub.onDirtyStateChanged =
      this.handleDirtyStateChanged.bind(this);

    this.modelManagerSubscription = modelManager.subscribe();
    this.modelManagerSubscription.onModelLoaded =
      this.notifyModelLoaded.bind(this);
    this.modelManagerSubscription.onModelUnloaded =
      this.notifyModelUnloaded.bind(this);
  }

  dispose(): void {
    this.disposed = true;
    this.liveValidation = false;
    this.selfSubscription.close();
    this.modelManagerSubscription.close();
    Array.from(this.contributions.values())
      .filter(isDisposable)
      .forEach((contrib) => safeCallback(contrib, contrib.dispose));
    this.notifyDisposed();

    this.contributions.clear();
    this.subscriptions.forEach((sub) => sub.subscription.close());
    this.subscriptions.length = 0;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  addModelServiceContribution<M extends object = object>(
    modelServiceContribution: ModelServiceContribution<K, M>
  ): void {
    const id = modelServiceContribution.id;
    if (this.contributions.has(id)) {
      throw new Error(
        'A ModelServiceContribution is already registered for id: ' + id
      );
    }
    this.contributions.set(id, modelServiceContribution);
    modelServiceContribution.setModelManager(this.modelManager);
    modelServiceContribution.setModelAccessorBus(this.modelAccessorBus);

    const validators =
      modelServiceContribution.validationContribution?.getValidators() ?? [];
    validators.forEach((v) => this.validationService.addValidator(v));
    modelServiceContribution.setValidationService(this.validationService);

    const triggers =
      modelServiceContribution.triggerContribution?.getTriggers() ?? [];
    triggers.forEach((t) => this.triggerEngine?.addModelTrigger(t));

    const providers =
      modelServiceContribution.modelAccessorContribution?.getProviders() ?? [];
    providers.forEach((provider) => {
      if (typeof (provider as HubAwareProvider).setModelHub === 'function') {
        (provider as HubAwareProvider<K, C>).setModelHub(this);
      }
      this.modelAccessorBus.register(provider);
    });

    // Do not set the contribution's hub yet as this is required to be done only
    // after all contributions are added, configured, and available to one other
  }

  get liveValidation(): boolean {
    return this.liveValidationSubscription !== undefined;
  }

  set liveValidation(liveValidation: boolean) {
    if (liveValidation === this.liveValidation) {
      return;
    }

    // We're toggling live validation state
    if (this.liveValidationSubscription) {
      // Turn off live validation: close the subscription
      this.liveValidationSubscription.close();
      this.liveValidationSubscription = undefined;
    } else {
      // Turn on live validation: create the subscription
      this.liveValidationSubscription = this.modelManager.subscribe();
      this.liveValidationSubscription.onModelChanged = (modelId: K) =>
        this.validateModels(modelId);
    }
  }

  private get triggerEngine(): ModelTriggerEngine<K> | undefined {
    return 'triggerEngine' in this.modelManager &&
      this.modelManager.triggerEngine instanceof ModelTriggerEngine
      ? this.modelManager.triggerEngine
      : undefined;
  }

  getModelService<S = unknown>(id: string): S | undefined {
    const contribution = this.contributions.get(id);
    return contribution?.getModelService();
  }

  getModelAccessorBus(): ModelAccessorBus {
    return this.modelAccessorBus;
  }

  async getModel<M extends object = object>(modelId: K): Promise<M> {
    // Check if model is already loaded
    const existingModel = this.modelManager.getModel<M>(modelId) as M;
    if (existingModel !== undefined) {
      return existingModel;
    }

    return this.loadModel(modelId);
  }

  // Find the persistence contribution responsible for loading
  // the requested model and load it. If a load of the same
  // model is already pending, return that pending promise.
  private loadModel<M extends object>(modelId: K): Promise<M> {
    let result = this.pendingLoads.get(modelId) as Promise<M>;
    if (!result) {
      result = this.getPersistenceContribution<M>(modelId).then((contrib) =>
        contrib.loadModel(modelId)
      );
      this.pendingLoads.set(modelId, result);
      result
        .then((loadedModel) => {
          this.modelManager.setModel(modelId, loadedModel);
        })
        .finally(() => this.pendingLoads.delete(modelId));
    }
    return result;
  }

  subscribe<M extends object = object>(
    ...modelIds: K[]
  ): ModelHubSubscription<K, M> {
    const subscription = <ModelHubSubscription<K, M>>{};

    const onModelChanged = (modelId: K, model: M, delta?: Operation[]) =>
      subscription.onModelChanged?.(modelId, model, delta);
    const onValidationChanged = (
      modelId: K,
      model: M,
      diagnostic: Diagnostic
    ) => subscription.onModelValidated?.(modelId, model, diagnostic);

    const entry: SubscriptionEntry<K> = {
      modelIds: modelIds.length ? new Set(modelIds) : undefined,
      subscription,
    };
    this.subscriptions.push(entry);

    if (modelIds.length === 0) {
      // Easy case: universal subscription
      const modelSubscription = this.modelManager.subscribe<M>();
      modelSubscription.onModelChanged = onModelChanged;
      const validationSubscription = this.validationService.subscribe<M>();
      validationSubscription.onValidationChanged = onValidationChanged;

      subscription.close = () => {
        modelSubscription.close();
        validationSubscription.close();
        pull(this.subscriptions, entry);
      };
    } else {
      // Subscription to particular models
      const modelSubs = modelIds.map((id) =>
        this.modelManager.subscribe<M>(id)
      );
      modelSubs.forEach((sub) => (sub.onModelChanged = onModelChanged));
      const validationSubs = modelIds.map((id) =>
        this.validationService.subscribe<M>(id)
      );
      validationSubs.forEach(
        (sub) => (sub.onValidationChanged = onValidationChanged)
      );

      subscription.close = () => {
        modelSubs.forEach((sub) => sub.close());
        validationSubs.forEach((sub) => sub.close());
        pull(this.subscriptions, entry);
      };
    }

    return subscription;
  }

  async save(...commandStackIds: string[]): Promise<boolean> {
    let result = false;

    const allCommandStackIds = commandStackIds.length
      ? commandStackIds
      : this.modelManager.getCommandStackIds();

    for (const commandStackId of allCommandStackIds) {
      const commandStack = this.getCommandStack(commandStackId);
      const modelIdsToSave = commandStack.getDirtyModelIds();
      for (const modelId of modelIdsToSave) {
        const persistenceContribution = await this.getPersistenceContribution(
          modelId
        );
        const model = await this.getModel(modelId);
        const saved = await persistenceContribution.saveModel(modelId, model);
        result ||= saved;
      }
      commandStack.markSaved();
    }

    return result;
  }

  async validateModels(...modelIds: K[]): Promise<Diagnostic> {
    const allDiagnostics: Promise<Diagnostic>[] = [];
    const allIds = modelIds.length ? modelIds : this.modelManager.getModelIds();
    for (const modelId of allIds) {
      allDiagnostics.push(
        this.getModel(modelId)
          .then((model) => this.validationService.validate(modelId, model))
          .catch((error) => ({
            severity: 'error',
            source: '@eclipse-emfcloud/model-service',
            path: '',
            message: `Failed to load model '${modelId}'.`,
            data: error,
          }))
      );
    }
    return merge(...(await Promise.all(allDiagnostics)));
  }

  getValidationState(...modelIds: K[]): Diagnostic | undefined {
    const allDiagnostics: Diagnostic[] = [];
    const allIds = modelIds.length ? modelIds : this.modelManager.getModelIds();
    for (const modelId of allIds) {
      const modelDiagnostic =
        this.validationService.getValidationState(modelId);
      if (modelDiagnostic) {
        allDiagnostics.push(modelDiagnostic);
      }
    }
    return allDiagnostics.length ? merge(...allDiagnostics) : undefined;
  }

  protected getCommandStack(commandStackId: string): CommandStack<K> {
    return this.modelManager.getCommandStack(commandStackId);
  }

  async undo(commandStackId: string): Promise<boolean> {
    const commandStack = this.getCommandStack(commandStackId);
    if (await commandStack.canUndo()) {
      const deltas = await commandStack.undo();
      return (deltas?.size ?? 0) > 0;
    }
    return false;
  }

  async redo(commandStackId: string): Promise<boolean> {
    const commandStack = this.getCommandStack(commandStackId);
    if (await commandStack.canRedo()) {
      const deltas = await commandStack.redo();
      return (deltas?.size ?? 0) > 0;
    }
    return false;
  }

  flush(commandStackId: string): boolean {
    const commandStack = this.getCommandStack(commandStackId);
    return commandStack.flush().length > 0;
  }

  isDirty(commandStackId: string): boolean {
    const commandStack = this.getCommandStack(commandStackId);
    return commandStack.isDirty();
  }

  protected handleDirtyStateChanged(
    ...args: Parameters<DirtyStateChangedCallback<K>>
  ): void {
    const editingContext = args[0];
    const modelDirtyState = args[1];

    // Function to snapshot the currently dirty model IDs
    const computeDirtyModelIds = () =>
      new Set(
        Array.from(this.dirtyState.entries())
          .filter(([_, dirtyIn]) => dirtyIn.size > 0)
          .map(([modelId]) => modelId)
      );
    const oldDirtyModelIds = computeDirtyModelIds();

    // Update my aggregate per-model dirty state
    for (const [modelId, isDirty] of modelDirtyState.entries()) {
      const dirtyState = this.dirtyState.get(modelId) ?? new Set();
      this.dirtyState.set(modelId, dirtyState);

      if (isDirty) {
        dirtyState.add(editingContext);
      } else {
        dirtyState.delete(editingContext);
      }
    }

    const newDirtyModelIds = computeDirtyModelIds();

    // Compute the symmetric difference
    Array.from(oldDirtyModelIds).forEach((modelId) => {
      if (newDirtyModelIds.delete(modelId)) {
        oldDirtyModelIds.delete(modelId);
      }
    });

    const notify = async (isDirty: boolean, modelIds: Set<K>) => {
      modelIds.forEach((modelId) => {
        this.subscriptions
          .filter((sub) => !sub.modelIds || sub.modelIds.has(modelId))
          .forEach(async (sub) => {
            const model = await this.getModel(modelId);
            if (sub.subscription.onModelDirtyState && model) {
              safeCallback(
                undefined,
                sub.subscription.onModelDirtyState,
                modelId,
                model,
                isDirty
              );
            }
          });
      });
    };

    notify(false, oldDirtyModelIds);
    notify(true, newDirtyModelIds);
  }

  private async getPersistenceContribution<M extends object = object>(
    modelId: K
  ): Promise<ModelPersistenceContribution<K, M>> {
    // Find a contribution able to handle the requested model
    for (const contribution of this.contributions.values()) {
      if (await contribution.persistenceContribution.canHandle(modelId)) {
        const result = contribution.persistenceContribution;
        // This cast makes sense because the contribution averred that it can handle the model
        return result as ModelPersistenceContribution<K, M>;
      }
    }
    throw new Error(
      'Failed to find a model persistence contribution for ModelID: ' + modelId
    );
  }

  /**
   * Handle the self-subscription notification of the loading of the
   * identified model. This default implementation validates the newly
   * loaded model if {@link liveValidation} is on.
   */
  protected handleModelLoaded(modelId: K): void {
    if (this.liveValidation) {
      this.validateModels(modelId);
    }
  }

  /**
   * Invoke the model-loaded call-back of subscribers for the given
   * model ID that have the call-back.
   */
  private notifyModelLoaded(modelId: K): void {
    this.subscriptions
      .filter((sub) => !sub.modelIds || sub.modelIds.has(modelId))
      .forEach((sub) => {
        if (sub.subscription.onModelLoaded) {
          safeCallback(undefined, sub.subscription.onModelLoaded, modelId);
        }
      });
  }

  /**
   * Invoke the model-unloaded call-back of subscribers for the given
   * model ID that have the call-back.
   */
  private notifyModelUnloaded(modelId: K, model: object): void {
    this.subscriptions
      .filter((sub) => !sub.modelIds || sub.modelIds.has(modelId))
      .forEach((sub) => {
        if (sub.subscription.onModelUnloaded) {
          safeCallback(
            undefined,
            sub.subscription.onModelUnloaded,
            modelId,
            model
          );
        }
      });
  }

  /**
   * Invoke the disposed call-back of subscribers that have the call-back.
   */
  private notifyDisposed(): void {
    this.subscriptions.forEach((sub) => {
      if (sub.subscription.onModelHubDisposed) {
        safeCallback(undefined, sub.subscription.onModelHubDisposed);
      }
    });
  }
}

/**
 * Record of a Model Hub subscription.
 */
interface SubscriptionEntry<K> {
  /** The model IDs, if any, that the subscription targets. */
  modelIds?: Set<K>;
  /** The subscription. */
  subscription: ModelHubSubscription<K>;
}

/**
 * Safely invoke a call-back, reporting any uncaught exception that it
 * may throw, to ensure that subsequent subscriptions don't miss out.
 */
const safeCallback = <F extends (this: unknown, ...args: unknown[]) => void>(
  thisArg: unknown,
  callback: F,
  ...args: Parameters<F>
): void => {
  try {
    callback.call(thisArg, ...args);
  } catch (error) {
    console.error('Uncaught exception in ModelHub call-back.', error);
  }
};

/** Type predicate for a disposable object. */
const isDisposable = <T extends object>(
  target: T
): target is T & { dispose(): void } => {
  return 'dispose' in target && typeof target.dispose === 'function';
};
