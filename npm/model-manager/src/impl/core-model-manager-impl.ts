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

import { Operation } from 'fast-json-patch';
import { cloneDeep } from 'lodash';
import {
  ChangeSubscription,
  Command,
  CoreCommandStack,
  CoreModelManager,
  groupByModelId,
} from '../core';
import {
  CoreCommandStackImpl,
  WorkingCopyManager,
  getModelIds,
} from './core-command-stack-impl';

export class CoreModelManagerImpl<K> implements CoreModelManager<K> {
  /** Model storage. */
  private readonly _modelStore: ModelStore<K>;

  /** A pointer to the commandStack for editing the models. */
  private readonly _commandStack: CoreCommandStack<K>;

  private _subscriptions = new Map<K, ChangeSubscription<K>[]>();
  private _allSubscriptions = new Array<ChangeSubscription<K>>();

  constructor(
    commandStackFactory: (
      workingCopyManager: WorkingCopyManager<K>
    ) => CoreCommandStack<K> = (workingCopyManager) =>
      new CoreCommandStackImpl(workingCopyManager)
  ) {
    this._modelStore = new ModelStore<K>(this.changeOnCommandStack.bind(this));
    this._commandStack = commandStackFactory(this._modelStore);
  }

  /**
   * The callback provided to the CoreCommandStackImpl to be able to notify
   * subscribers of any command executed (execute, executeAndAppend, undo, redo )
   *
   * @param deltas the command result sent by 'execute, executeAndAppend, undo or redo' done in CoreCommandStackImpl
   */
  private changeOnCommandStack(deltas: Map<Command<K>, Operation[]>) {
    groupByModelId(deltas).forEach((operations, modelId) => {
      const model = this.getModel(modelId);
      if (model === undefined) {
        return;
      }
      for (const subscriber of this.subscriptions(modelId)) {
        if (subscriber.onModelChanged) {
          subscriber.onModelChanged(modelId, model, operations);
        }
      }
    });
  }

  getModelId(model: object): K | undefined {
    return this._modelStore.getModelId(model);
  }

  getModel<M extends object = object>(modelId: K): M | undefined {
    return this._modelStore.getModel(modelId);
  }

  setModel(modelId: K, model: object): void {
    this._modelStore.addModel(modelId, model);
  }

  getModelIds(): K[] {
    return this._modelStore.getModelIds();
  }

  removeModel<M extends object = object>(modelId: K): M | undefined {
    return this._modelStore.removeModel(modelId);
  }

  getCommandStack(): CoreCommandStack<K> {
    return this._commandStack;
  }

  private addSubscription(modelId: K, subscription: ChangeSubscription<K>) {
    const existingSubscriptions = this._subscriptions.get(modelId) || [];
    existingSubscriptions.push(subscription);
    this._subscriptions.set(modelId, existingSubscriptions);
  }

  private addAllSubscription(subscription: ChangeSubscription<K>) {
    this._allSubscriptions.push(subscription);
  }

  private deleteSubscription(modelId: K, subscription: ChangeSubscription<K>) {
    const existingSubscriptions = this._subscriptions.get(modelId) || [];
    const index = existingSubscriptions.indexOf(subscription);
    if (index > -1) {
      existingSubscriptions.splice(index, 1);
      if (existingSubscriptions.length > 0) {
        this._subscriptions.set(modelId, existingSubscriptions);
      } else {
        this._subscriptions.delete(modelId);
      }
    }
  }

  private deleteAllSubscription(subscription: ChangeSubscription<K>) {
    const index = this._allSubscriptions.indexOf(subscription);
    if (index > -1) {
      this._allSubscriptions.splice(index, 1);
    }
  }

  subscribe<M extends object = object>(modelId?: K): ChangeSubscription<K, M> {
    let subscription: ChangeSubscription<K, M>;
    if (modelId) {
      subscription = {
        close: () => this.deleteSubscription(modelId, subscription),
      };
      this.addSubscription(modelId, subscription);
    } else {
      subscription = {
        close: () => this.deleteAllSubscription(subscription),
      };
      this.addAllSubscription(subscription);
    }
    return subscription;
  }

  /**
   * Obtain an iterable over all subscriptions pertaining to the given
   * model ID.
   *
   * @param modelId a model ID for which to get subscriptions
   * @returns an iterator over all subscriptions specific to the `modelId` (if any)
   *   followed by the general subscriptions
   */
  protected *subscriptions<M extends object = object>(
    modelId: K
  ): Iterable<ChangeSubscription<K, M>> {
    const specific = this._subscriptions.get(modelId);
    if (specific) {
      for (const next of specific) {
        yield next;
      }
    }
    for (const next of this._allSubscriptions) {
      yield next;
    }
  }
}

class ModelStore<K = string> implements WorkingCopyManager<K> {
  /** Model storage. */
  private readonly _models = new Map<K, object>();
  /** Last known ID for each model. */
  private readonly _modelIds = new WeakMap<object, K>();

  private _workingCopies = new Map<K, object>();
  private _open = new Map<K, boolean>();

  constructor(
    private readonly notify: (result: Map<Command<K>, Operation[]>) => void
  ) {}

  getModel<M extends object = object>(modelId: K): M | undefined {
    return this._models.get(modelId) as M | undefined;
  }

  getModelId(model: object): K | undefined {
    return this._modelIds.get(model);
  }

  getModelIds(): K[] {
    return Array.from(this._models.keys());
  }

  addModel(modelId: K, model: object): void {
    if (this._models.get(modelId) !== undefined) {
      throw new Error(`Model ${modelId} is already registered.`);
    }
    this._models.set(modelId, model);
    this._modelIds.set(model, modelId);
  }

  removeModel<M extends object = object>(modelId: K): M | undefined {
    const removedModel = this.getModel<M>(modelId);
    if (removedModel !== undefined) {
      this._models.delete(modelId);
      // Let the generation info expire naturally with GC
    }
    return removedModel;
  }

  //
  // WorkingCopyManager protocol
  //

  open(modelIds: K[]): void {
    if (this.isOpen(modelIds)) {
      throw new Error('Already open.');
    }
    modelIds.forEach((modelId) => {
      this._open.set(modelId, true);
      this._workingCopies.delete(modelId);
    });
  }

  isOpen(modelIds: K[]): boolean {
    return modelIds.some((modelId) => this._open.get(modelId));
  }

  getWorkingCopy(modelId: K): object | undefined {
    if (!this.isOpen([modelId])) {
      throw new Error('Not open.');
    }
    let result = this._workingCopies.get(modelId);
    if (result === undefined) {
      const model = this.getModel(modelId);
      if (model !== undefined) {
        result = cloneDeep(model);
        this._workingCopies.set(modelId, result);
      }
    }
    return result;
  }

  commit(result: Map<Command<K>, Operation[]>): void {
    const modelIds = Array.from(result.keys()).reduce((acc, c) => {
      const modelIds = getModelIds(c);
      modelIds.forEach((id) => acc.add(id));
      return acc;
    }, new Set<K>());

    try {
      for (const modelId of modelIds) {
        const workingCopy = this._workingCopies.get(modelId);
        if (workingCopy !== undefined) {
          this._models.set(modelId, workingCopy);
        }
        this._workingCopies.delete(modelId);
      }
      this.notify(result);
    } finally {
      for (const k of modelIds.keys()) {
        this._open.delete(k);
      }
    }
  }

  cancel(modelIds: K[]): void {
    modelIds.forEach((modelId) => {
      this._workingCopies.delete(modelId);
      this._open.delete(modelId);
    });
  }
}
