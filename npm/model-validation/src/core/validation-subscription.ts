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

import { Diagnostic } from './diagnostic';

/**
 * Call-back signature for notification of updates to the validation state
 * of models.
 *
 * @template K the type of model identifier in the validation service
 * @template M the type of model object that is validated
 *
 * @param modelId the unique identifier of the model that was validated
 * @param model the model that was validated
 * @param diagnostic the validation state that was computed or updated for the model
 */
export type ValidationListener<K, M extends object = object> = (
  modelId: K,
  model: M,
  diagnostic: Diagnostic
) => void;

/**
 * Interface of an object that provides notification of updates to the
 * validation state of models.
 *
 * @template K the type of model identifier in the validation service
 * @template M the type of model object that is validated
 */
export interface ValidationSubscription<K, M extends object = object> {
  /**
   * The call-back function to invoke on notification of validation state.
   */
  onValidationChanged?: ValidationListener<K, M>;

  /**
   * Terminate the subscription. After the subscription is closed,
   * the {@link onValidationChanged} call-back will not be invoked
   * for any future validation updates.
   */
  close(): void;
}
