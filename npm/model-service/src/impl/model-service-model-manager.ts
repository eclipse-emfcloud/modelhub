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

import {
  ChangeSubscription,
  Command,
  CoreCommandStackImpl,
  CoreModelManagerImpl,
  PatchCommand,
  append,
  isCompoundCommand,
} from '@eclipse-emfcloud/model-manager';
import {
  ModelManager,
  ModelManagerImpl,
} from '@eclipse-emfcloud/model-manager/lib/api/model-manager';
import { WorkingCopyManager } from '@eclipse-emfcloud/model-manager/lib/impl/core-command-stack-impl';
import { Operation } from 'fast-json-patch';
import { cloneDeep } from 'lodash';
import { ModelLoadedCallback, ModelUnloadedCallback } from '../api';
import { ModelTriggerEngine } from './model-trigger-engine';

/**
 * Protocol for a model manager with integrated trigger engine.
 */
export interface ModelServiceModelManager<K> extends ModelManager<K> {
  /** The trigger engine to which triggers may be added. */
  readonly triggerEngine: ModelTriggerEngine<K>;
}

/**
 * Create a new model manager for model services.
 * @returns the model manager
 */
export const createModelServiceModelManager = <
  K
>(): ModelServiceModelManager<K> => {
  return new ModelServiceModelManagerImpl<K>(new ModelTriggerEngine<K>());
};

/**
 * Implementation of the model manager with triggers.
 */
class ModelServiceModelManagerImpl<K = string> extends ModelManagerImpl<K> {
  constructor(public readonly triggerEngine: ModelTriggerEngine<K>) {
    super(new CoreModelServiceModelManager<K>(triggerEngine));
  }
}

/**
 * Implementation of the core model manager with triggers.
 */
class CoreModelServiceModelManager<K = string> extends CoreModelManagerImpl<K> {
  constructor(protected readonly triggerEngine: ModelTriggerEngine<K>) {
    super((workingCopyManager) => {
      workingCopyManager.createFollowUpCommand = (commandResult) =>
        this.applyTriggers(workingCopyManager, commandResult);

      return new CoreCommandStackImpl<K>(workingCopyManager);
    });
  }

  setModel(modelId: K, model: object): void {
    super.setModel(modelId, model);

    // Super would have thrown if the model had already been present
    for (const next of this.subscriptions(modelId)) {
      const sub: ModelManagerSubscription<K> = next;
      sub.onModelLoaded?.(modelId);
    }
  }

  removeModel<M extends object = object>(modelId: K): M | undefined {
    const result = super.removeModel<M>(modelId);

    if (result) {
      for (const next of this.subscriptions<M>(modelId)) {
        const sub: ModelManagerSubscription<K, M> = next;
        sub.onModelUnloaded?.(modelId, result);
      }
    }

    return result;
  }

  /**
   * Apply any follow-up patches to the given `commandResult` provided by registered triggers.
   *
   * @param commandResult description of changes executed/undone/redone in the models
   * @returns a command, if any, applying the triggered patches that follow up the original changes
   */
  private async applyTriggers(
    workingCopyManager: WorkingCopyManager<K>,
    commandResult: Map<Command<K>, Operation[]> | undefined
  ): Promise<Command<K> | undefined> {
    if (!commandResult) {
      return undefined;
    }

    let result: Command<K> | undefined;

    for (const [command, delta] of commandResult) {
      const { modelId, model, previousModelState } = this.getModelFromCommand(
        command,
        workingCopyManager
      );
      if (modelId == null || model == null || previousModelState == null) {
        // Cannot run triggers without a model ID
        continue;
      }

      // Get a safe copy of the previous model state for triggers to use
      const safePreviousModelState = cloneDeep(previousModelState);
      const triggerPatch = await this.triggerEngine.applyModelTriggers(
        modelId,
        model,
        delta,
        safePreviousModelState
      );
      if (triggerPatch) {
        const patchCommand = new PatchCommand<K>(
          'Apply triggers',
          modelId,
          triggerPatch
        );
        result = result ? append(result, patchCommand) : patchCommand;
      }
    }

    return result;
  }

  /**
   * Extract from a command appearing in an execution/undo/redo result the model
   * that it modified, together with its ID.
   *
   * @param command a command keyed in the result map of command execution/undo/redo
   * @param workingCopyManager to get the working copies of models edited by the `command`
   * @returns the identified model that the command modified
   */
  protected getModelFromCommand<M extends object = object>(
    command: Command<K>,
    workingCopyManager: WorkingCopyManager<K>
  ): {
    modelId?: K;
    model?: M;
    previousModelState?: M;
  } {
    // Compound commands do not appear in a command-result map. If somehow they do, then
    // that is an error elsewhere
    const modelId = isCompoundCommand(command) ? undefined : command.modelId;
    const model = modelId
      ? (workingCopyManager.getWorkingCopy(modelId) as M | undefined)
      : undefined;

    const previousModelState = modelId
      ? (workingCopyManager.getModel(modelId) as M | undefined)
      : undefined;

    return { modelId, model, previousModelState };
  }
}

/**
 * Specialization of the core Model Manager subscription protocol that adds
 * optional call-backs for model load and unload notifications.
 */
export interface ModelManagerSubscription<K = string, M extends object = object>
  extends ChangeSubscription<K, M> {
  /** Optional model load call-back. */
  onModelLoaded?: ModelLoadedCallback<K>;
  /** Optional model unload call-back. */
  onModelUnloaded?: ModelUnloadedCallback<K, M>;
}
