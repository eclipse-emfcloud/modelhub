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
import { ModelTriggerContribution } from '@eclipse-emfcloud/model-service';

export function createTriggerContribution(): ModelTriggerContribution<
  string,
  ModelB
> {
  return {
    getTriggers() {
      return [
        {
          getPatch: (modelId, model: ModelB, delta) => {
            if (!modelId.endsWith(MODEL_B_MODEL_ID)) {
              // Not a model B
              return undefined;
            }

            if (
              !delta.some(
                (op) => op.path === '/fooB' || op.path === '/lengthOfFooB'
              )
            ) {
              // neither fooB nor lengthOfFooB changed (we need to fix any attempt to override the derived property)
              return undefined;
            }

            if (model.lengthOfFooB !== model.fooB?.length) {
              return [
                {
                  op: model.lengthOfFooB !== undefined ? 'replace' : 'add',
                  path: '/lengthOfFooB',
                  value: model.fooB?.length ?? 0,
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
