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

import { interfaces } from '@theia/core/shared/inversify';

import { ModelHubProtocol, timeout } from '../common';
import { ModelHubTracker } from '../common/model-hub-tracker';
import {
  FrontendModelHubContext,
  FrontendModelHubImpl,
  FrontendModelHubProvider,
} from './frontend-model-hub';

/**
 * Bind the `FrontendModelHubProvider` service in _Inversify_.
 */
export function bindFrontendModelHubProvider(bind: interfaces.Bind): void {
  bind(FrontendModelHubProvider).toProvider(({ container }) => {
    const tracker = container.get<ModelHubTracker>(ModelHubTracker);
    return async (context: string) => {
      // Ensure the initialization of the RPC Protocol so that we may receive
      // notifications from the backend
      container.get(ModelHubProtocol);

      const child = container.createChild();
      child.bind(FrontendModelHubImpl).toSelf();
      child.bind(FrontendModelHubContext).toConstantValue(context);

      if (tracker.isModelHubAvailable(context)) {
        // Easy case: it's already available in the backend
        return child.get(FrontendModelHubImpl);
      }

      // Need to wait for it to become available in the backend
      const sub = tracker.trackModelHubs();
      const result = new Promise<FrontendModelHubImpl<string>>(
        (resolve, reject) => {
          sub.onModelHubCreated = (createdContext) => {
            if (createdContext === context) {
              try {
                resolve(child.get(FrontendModelHubImpl));
              } catch (error) {
                reject(error);
              }
            }
          };
        }
      );
      return timeout(result).finally(() => sub.close());
    };
  });
}
