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
 * Protocol for a validation algorithm on some model.
 *
 * @template K the type of model identifier in the validation service
 * @template M the type of model validated by the validator
 */
export interface Validator<K, M extends object = object> {
  /**
   * Compute the validation state of the given `model`.
   * A validator that does not provide any validation of the
   * particular given `model` must return an `'ok'` diagnostic.
   * A validator is not required to support validation of sub-models
   * or individual elements of a model.
   *
   * @param modelId the unique identifier of the `model` to validate
   * @param model the model to validate
   * @returns the `model`'s validation state from the perspective of this validator
   */
  validate(modelId: K, model: M): Promise<Diagnostic>;
}
