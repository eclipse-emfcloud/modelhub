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

import { Trigger, TriggerEngineImpl } from '@eclipse-emfcloud/trigger-engine';
import { Operation } from 'fast-json-patch';
import { ModelTrigger } from '../api/model-trigger';

interface ModelWithId<K = string, M extends object = object> {
  modelId: NonNullable<K>;
  model: NonNullable<M>;
}

/**
 * A customized trigger engine that wraps the models it operates on
 * to decorate them with the `modelId`, which is subsequently extracted
 * to pass along to the `ModelTrigger`s that are adapted for that usage.
 */
export class ModelTriggerEngine<K = string> extends TriggerEngineImpl {
  /**
   * Compute triggers for changes to a `model`.
   *
   * @param modelId the model ID for which to compute triggers
   * @param model the model document for which to compute triggers
   * @param delta the changes for which to compute triggers
   * @param previousModel the previous state of the model document before the `delta`
   * @returns the new changes provided by triggers to follow up the `delta`, if any
   */
  async applyModelTriggers<M extends object = object>(
    modelId: NonNullable<K>,
    model: NonNullable<M>,
    delta: Operation[],
    previousModel: NonNullable<M>
  ): Promise<Operation[] | undefined> {
    if (!delta.length) {
      return undefined;
    }
    const modelWithId = { modelId, model };
    const prevModelWithId = { modelId, model: previousModel };
    return this.applyTriggers(modelWithId, delta, prevModelWithId);
  }

  addModelTrigger<M extends object = object>(
    modelTrigger: ModelTrigger<K, M>
  ): void {
    this.addTrigger<ModelWithId<K, M>>(this.adaptTrigger<M>(modelTrigger));
  }

  protected adaptTrigger<M extends object = object>(
    trigger: ModelTrigger<K, M>
  ): Trigger<ModelWithId<K, M>> {
    return async (document, delta, previousDocument) => {
      const { modelId, model } = document;
      const { model: previousModel } = previousDocument;
      return trigger.getPatch(modelId, model, delta, previousModel);
    };
  }

  protected override applyPatch(
    workingCopy: NonNullable<ModelWithId>,
    patch: Operation[]
  ): void {
    super.applyPatch(workingCopy.model, patch);
  }

  protected override compare<M extends object = object>(
    document: NonNullable<ModelWithId<K, M>>,
    workingCopy: NonNullable<ModelWithId<K, M>>
  ): Operation[] {
    return super.compare(document.model, workingCopy.model);
  }
}
