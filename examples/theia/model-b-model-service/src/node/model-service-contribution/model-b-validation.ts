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
import {
  MODEL_B_MODEL_ID,
  ModelB,
} from '@eclipse-emfcloud-example/model-b-api';
import { ModelValidationContribution } from '@eclipse-emfcloud/model-service';
import { Diagnostic, ok } from '@eclipse-emfcloud/model-validation';

export function createValidationContribution(): ModelValidationContribution<
  string,
  ModelB
> {
  const isModelB = (modelId: string) => modelId.toString() === MODEL_B_MODEL_ID;

  return {
    getValidators() {
      return [
        {
          validate: (modelId: string, model: ModelB) => {
            const diagnostic: Diagnostic = ok();
            if (isModelB(modelId) && model.name.length > 30) {
              diagnostic.path = '/name';
              diagnostic.message = `The full name must not exceed 30 characters (currently ${model.name.length})`;
              diagnostic.severity = 'error';
              diagnostic.code = '1';
            }
            return Promise.resolve(diagnostic);
          },
        },
        {
          validate: (modelId: string, model: ModelB) => {
            const diagnostic: Diagnostic = ok();
            if (isModelB(modelId) && model.name.trim().length < 3) {
              diagnostic.path = '/name';
              diagnostic.message = `The full name must contain at least 3 characters (currently ${
                model.name.trim().length
              })`;
              diagnostic.severity = 'error';
              diagnostic.code = '2';
            }
            return Promise.resolve(diagnostic);
          },
        },
        {
          validate: (modelId: string, model: ModelB) => {
            const diagnostic: Diagnostic = ok();
            const pattern = /^([ a-zA-Zéèêîïëâäà-])+$/;
            if (isModelB(modelId) && !pattern.test(model.name)) {
              diagnostic.path = '/name';
              diagnostic.message = `The full name should only contain letters`;
              diagnostic.severity = 'warn';
              diagnostic.code = '3';
            }
            return Promise.resolve(diagnostic);
          },
        },
        {
          validate: (modelId: string, model: ModelB) => {
            const diagnostic: Diagnostic = ok();
            const pattern = /^([ a-zA-Zéèêîïëâäà-])+$/;
            if (isModelB(modelId) && !pattern.test(model.fooB)) {
              diagnostic.path = '/fooB';
              diagnostic.message = `FooB should only contain letters`;
              diagnostic.severity = 'warn';
              diagnostic.code = '3';
            }
            return Promise.resolve(diagnostic);
          },
        },
      ];
    },
  };
}
