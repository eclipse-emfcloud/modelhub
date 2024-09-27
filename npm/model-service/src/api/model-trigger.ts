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

import { MaybePromise } from '@eclipse-emfcloud/model-manager';
import { Operation } from 'fast-json-patch';

/** The eventual type of a trigger result. */
export type ModelTriggerPatch = Operation[] | undefined;

/**
 * Protocol for a calculation of an update to a model consequent of some patch
 * to it.
 *
 * @template K the model identifier type
 * @template M the model type
 */
export interface ModelTrigger<K = string, M extends object = object> {
  /**
   * Get a new patch, if necessary, that would apply further changes to
   * a given `model` consequent from changes previously applied to it,
   * described by the given `delta`.
   *
   * @param modelId the ID of the model that has been updated
   * @param model a model that has been updated. This model is in the _after_
   *   state with respect to the `delta`, which is to say that it has already been
   *   updated as described by the delta
   * @param delta a patch describing the changes that were applied to it. The `delta`
   *   may include `test` assertion operations. It is guaranteed to comprise at least
   *   one operation that is not a `test`
   * @param previousModel the `model` as it was before the changes described by
   *   the `delta` were performed on it. Thus, this is the _before_ state with respect to
   *   that `delta`
   * @returns a new patch, applicable to the current state of the `model`, describing
   *   additional changes that should be applied to it to follow up the triggering `delta`,
   *   or `undefined` if no follow-up is provided
   */
  getPatch(
    modelId: NonNullable<K>,
    model: NonNullable<M>,
    delta: Operation[],
    previousModel: NonNullable<M>
  ): MaybePromise<ModelTriggerPatch>;
}
