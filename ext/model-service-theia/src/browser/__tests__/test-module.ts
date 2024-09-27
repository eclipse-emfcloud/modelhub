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

import { ILogger } from '@theia/core';
import { ContainerModule } from '@theia/core/shared/inversify';
import {
  FrontendModelAccessorBus,
  FrontendModelAccessorBusImpl,
} from '../frontend-model-accessor-bus';
import {
  FrontendModelAccessorBusSubscriber,
  FrontendModelAccessorBusSubscriberImpl,
} from '../frontend-model-accessor-bus-subscriber';
import {
  FrontendModelHubContext,
  FrontendModelHubImpl,
  FrontendModelHubProvider,
} from '../frontend-model-hub';
import {
  FrontendModelHubSubscriber,
  FrontendModelHubSubscriberImpl,
} from '../frontend-model-hub-subscriber';
import { bindFakeModelAccessorBusProtocol } from './fake-model-accessor-bus-protocol';
import { bindFakeModelHubProtocol } from './fake-model-hub-protocol';

import { ModelHubTracker } from '../../common/model-hub-tracker';

// We don't just do, say, `error: console.error` because that will not
// let us stub/spy the `console.error` to verify logs
export const logger = {
  error: (...args: unknown[]) => console.error(...args),
  warn: (...args: unknown[]) => console.warn(...args),
  info: (...args: unknown[]) => console.info(...args),
  debug: (...args: unknown[]) => console.debug(...args),
};

export const testModule = new ContainerModule((bind) => {
  bind(ILogger).toConstantValue(logger);

  bind(FrontendModelAccessorBusSubscriberImpl).toSelf().inSingletonScope();
  bind(FrontendModelAccessorBusSubscriber).toService(
    FrontendModelAccessorBusSubscriberImpl
  );

  bind(FrontendModelAccessorBusImpl).toSelf().inSingletonScope();
  bind(FrontendModelAccessorBus).toService(FrontendModelAccessorBusImpl);

  bind(FrontendModelHubSubscriberImpl).toSelf().inSingletonScope();
  bind(FrontendModelHubSubscriber).toService(FrontendModelHubSubscriberImpl);
  bind(ModelHubTracker).toService(FrontendModelHubSubscriberImpl);

  bind(FrontendModelHubImpl).toSelf();
  bind(FrontendModelHubProvider).toProvider(({ container }) => {
    return (context: unknown) => {
      const child = container.createChild();
      child.bind(FrontendModelHubContext).toConstantValue(context);
      return Promise.resolve(child.get(FrontendModelHubImpl));
    };
  });

  bindFakeModelHubProtocol(bind);
  bindFakeModelAccessorBusProtocol(bind);
});
