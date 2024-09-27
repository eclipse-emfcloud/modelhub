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
import { ModelServiceContribution } from '@eclipse-emfcloud/model-service-theia/lib/node/';
import { ConnectionHandler, RpcConnectionHandler } from '@theia/core';
import { ContainerModule } from '@theia/core/shared/inversify';
import {
  MODEL_B_INTERNAL_API_PATH,
  ModelBInternalAPI,
  ModelBInternalClient,
} from '../common';
import { ModelBInternalAPIImpl } from './model-b-internal-api-impl';
import { ModelBModelServiceContribution } from './model-b-model-service-contribution';

export default new ContainerModule((bind) => {
  bind(ModelServiceContribution).to(ModelBModelServiceContribution);

  bind(ModelBInternalAPIImpl).toSelf().inSingletonScope();
  bind(ModelBInternalAPI).toService(ModelBInternalAPIImpl);
  bind(ConnectionHandler)
    .toDynamicValue(
      (ctx) =>
        new RpcConnectionHandler<ModelBInternalClient>(
          MODEL_B_INTERNAL_API_PATH,
          (client) => {
            const server = ctx.container.get(ModelBInternalAPIImpl);
            server.setClient(client);
            client.onDidCloseConnection(() => server.dispose());
            return server;
          }
        )
    )
    .inSingletonScope();
});
