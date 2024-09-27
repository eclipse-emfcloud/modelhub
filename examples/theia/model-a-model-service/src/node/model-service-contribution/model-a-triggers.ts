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
  MODEL_A_MODEL_ID,
  ModelA,
} from '@eclipse-emfcloud-example/model-a-api';
import { ModelTriggerContribution } from '@eclipse-emfcloud/model-service';

export function createTriggerContribution(): ModelTriggerContribution<
  string,
  ModelA
> {
  return {
    getTriggers() {
      return [
        {
          getPatch: (modelURI, model: ModelA, delta) => {
            if (!modelURI.endsWith(MODEL_A_MODEL_ID)) {
              // Not a model A
              return undefined;
            }

            if (
              !delta.some(
                (op) => op.path === '/fooA' || op.path === '/lengthOfFooA'
              )
            ) {
              // neither fooA nor lengthOfFooA changed (we need to fix any attempt to override the derived property)
              return undefined;
            }

            const expectedLengthOfFooA = model.fooA?.length ?? 0;
            if (model.lengthOfFooA !== expectedLengthOfFooA) {
              return [
                {
                  op: model.lengthOfFooA !== undefined ? 'replace' : 'add',
                  path: '/lengthOfFooA',
                  value: expectedLengthOfFooA,
                },
              ];
            }

            return undefined;
          },
        },
      ];
    },
  };
}
