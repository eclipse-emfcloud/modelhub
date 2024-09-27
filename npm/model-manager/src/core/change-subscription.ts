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

import type { Operation } from 'fast-json-patch';

/**
 * Function type for the `onModelChanged` call-back of a `ChangeSubscription`.
 *
 * @callback ModelChangedCallback
 *
 * @template K the type of key with which a changed model is associated
 * @template M the type of model object that is managed
 *
 * @param modelId identifies the model that changed
 * @param model the model that changed (the whole model, not just some object within it that changed)
 * @param delta if supported by the model manager and the commands that were executed, a description
 *  of the changes that occurred in the `model` as a JSON Patch
 */
export type ModelChangedCallback<K, M extends object = object> = (
  modelId: K,
  model: M,
  delta?: Operation[]
) => void;

/**
 * A subscription to changes in one or more models.
 * When the subscription is no longer needed, it should be `close()`d
 * to avoid the overhead of continuing to notify it.
 *
 * @template K the type of key with which a changed model is associated
 * @template M the type of model object that is managed
 */
export interface ChangeSubscription<K, M extends object = object> {
  /**
   * A function to call to notify the client of model changes.
   */
  onModelChanged?: ModelChangedCallback<K, M>;

  /**
   * Stop receiving notifications of model changes.
   */
  close(): void;
}
