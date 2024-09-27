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
  FrontendApplicationContribution,
  WebSocketConnectionProvider,
} from '@theia/core/lib/browser';
import { ContainerModule } from '@theia/core/shared/inversify';
import {
  SIMPLE_MODEL_PROJECT_SERVICE_PATH,
  SimpleModelProjectService,
} from '../common/protocol';
import { ExampleAppContribution } from './frontend-contribution';

export default new ContainerModule((bind) => {
  bind(FrontendApplicationContribution)
    .to(ExampleAppContribution)
    .inSingletonScope();

  bind(SimpleModelProjectService)
    .toDynamicValue((ctx) => {
      const connection = ctx.container.get(WebSocketConnectionProvider);
      return connection.createProxy<SimpleModelProjectService>(
        SIMPLE_MODEL_PROJECT_SERVICE_PATH
      );
    })
    .inSingletonScope();
});
