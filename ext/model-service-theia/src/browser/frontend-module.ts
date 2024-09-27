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

import { ServiceConnectionProvider } from '@theia/core/lib/browser/messaging/service-connection-provider';
import { ContainerModule } from '@theia/core/shared/inversify';

import {
  ModelAccessorBusProtocol,
  ModelAccessorBusProtocolServicePath,
  ModelHub,
  ModelHubContext,
  ModelHubProtocol,
  ModelHubProtocolServicePath,
} from '../common';
import { ModelHubTracker } from '../common/model-hub-tracker';
import {
  FrontendModelAccessorBus,
  FrontendModelAccessorBusImpl,
} from './frontend-model-accessor-bus';
import {
  FrontendModelAccessorBusSubscriber,
  FrontendModelAccessorBusSubscriberImpl,
} from './frontend-model-accessor-bus-subscriber';
import {
  FrontendModelHubContext,
  FrontendModelHubImpl,
} from './frontend-model-hub';
import { bindFrontendModelHubProvider } from './frontend-model-hub-provider';
import {
  FrontendModelHubSubscriber,
  FrontendModelHubSubscriberImpl,
} from './frontend-model-hub-subscriber';

export default new ContainerModule((bind) => {
  bind(FrontendModelAccessorBusSubscriberImpl).toSelf().inSingletonScope();
  bind(FrontendModelAccessorBusSubscriber).toService(
    FrontendModelAccessorBusSubscriberImpl
  );

  bind(FrontendModelAccessorBusImpl).toSelf().inSingletonScope();
  bind(FrontendModelAccessorBus).toService(FrontendModelAccessorBusImpl);

  bind(FrontendModelHubSubscriberImpl).toSelf().inSingletonScope();
  bind(FrontendModelHubSubscriber).toService(FrontendModelHubSubscriberImpl);
  bind(ModelHubTracker).toService(FrontendModelHubSubscriberImpl);

  bindFrontendModelHubProvider(bind);

  // This binding only works in containers (usually child containers)
  // that have the required ModelHubContext binding.
  // Note that this binding is not a singleton because
  //  - it would be hoisted to the parent container and so
  //    become the only hub that can ever be injected and
  //  - the singleton ModelHubManager in the backend
  //    already implements an effective singleton hub per context
  bind(ModelHub).toDynamicValue(({ container }) => {
    const child = container.createChild();
    child.bind(FrontendModelHubImpl).toSelf();
    child.bind(FrontendModelHubContext).toService(ModelHubContext);
    return child.get(FrontendModelHubImpl);
  });

  bind(ModelHubProtocol)
    .toDynamicValue(({ container }) => {
      const subscriber = container.get(FrontendModelHubSubscriberImpl);
      const result = ServiceConnectionProvider.createProxy<ModelHubProtocol>(
        container,
        ModelHubProtocolServicePath,
        subscriber.client
      );
      subscriber.setModelHub(result);
      return result;
    })
    .inSingletonScope();

  bind(ModelAccessorBusProtocol)
    .toDynamicValue(({ container }) => {
      const subscriber = container.get(FrontendModelAccessorBusSubscriberImpl);
      const result =
        ServiceConnectionProvider.createProxy<ModelAccessorBusProtocol>(
          container,
          ModelAccessorBusProtocolServicePath,
          subscriber.client
        );
      subscriber.setModelAccessorBus(result);
      return result;
    })
    .inSingletonScope();
});
