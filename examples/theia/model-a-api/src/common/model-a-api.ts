// *****************************************************************************
// Copyright (C) 2024 STMicroelectronics.
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
import { Command } from '@eclipse-emfcloud/model-manager';

export const MODEL_A_MODEL_ID = 'ModelA';

/**
 * The shape of the _Model A_ instance.
 */
export interface ModelA {
  fooA: string;
  lengthOfFooA: number;
  firstName: string;
  lastName: string;
  sum: number;
}

/**
 * Key used to register/access the _Model A_ public model API from
 * the `ModelHub`.
 */
export const MODEL_A_API = 'model-a-api';

/**
 * The public model API provided by the `ModelHub` for manipulation of
 * the _Model A_ instance by its dependents.
 */
export interface ModelAModelService {
  /**
   * Obtain a command to set the `sum` in a given model.
   * Returns `undefined` in the case that the model does not exist or
   * it already has the `sum`.
   */
  createSetSumCommand(
    modelURI: string,
    sum: number
  ): Promise<Command<string> | undefined>;
}
