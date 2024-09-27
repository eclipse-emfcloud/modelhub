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
import { WebSocketConnectionProvider } from '@theia/core/lib/browser';
import { ContainerModule } from '@theia/core/shared/inversify';
import { MODEL_B_INTERNAL_API_PATH, ModelBInternalAPI } from '../common';
import { ModelBInternalAPIWatcher } from './model-b-internal-api-watcher';

export default new ContainerModule((bind) => {
  bind(ModelBInternalAPIWatcher).toSelf().inSingletonScope();
  bind(ModelBInternalAPI)
    .toDynamicValue(({ container }) => {
      const connection = container.get(WebSocketConnectionProvider);
      const watcher = container.get(ModelBInternalAPIWatcher);
      return connection.createProxy<ModelBInternalAPI>(
        MODEL_B_INTERNAL_API_PATH,
        watcher.getInternalAPIClient()
      );
    })
    .inSingletonScope();
});
