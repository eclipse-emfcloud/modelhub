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

import {
  AbstractModelServiceContribution,
  ModelServiceContribution,
} from '@eclipse-emfcloud/model-service';
import {
  bindContributionProvider,
  ConnectionHandler,
  RpcConnectionHandler,
} from '@theia/core';
import {
  ContainerModule,
  decorate,
  injectable,
} from '@theia/core/shared/inversify';
import {
  ModelAccessorBusClient,
  ModelAccessorBusProtocolServicePath,
  ModelHub,
  ModelHubClient,
  ModelHubContext,
  ModelHubProtocolServicePath,
} from '../common';
import { ModelHubTracker } from '../common/model-hub-tracker';
import { ModelAccessorBusServer } from './model-accessor-bus-server';
import { ModelHubLifecycleContribution } from './model-hub-lifecycle-contribution';
import {
  DefaultModelHubManager,
  ModelHubManager,
  ModelServiceContributionFactory,
} from './model-hub-manager';
import { ModelHubProvider } from './model-hub-provider';
import { ModelHubServer } from './model-hub-server';
import { ModelServiceContribution as ModelServiceContributionIdentifier } from './model-service-contribution';

decorate(injectable(), AbstractModelServiceContribution);

export default new ContainerModule((bind) => {
  bind(DefaultModelHubManager).toSelf().inSingletonScope();
  bind(ModelHubManager).toService(DefaultModelHubManager);
  bind(ModelHubTracker).toService(DefaultModelHubManager);

  bind<ModelServiceContributionFactory>(
    ModelServiceContributionFactory
  ).toFactory(({ container }) => {
    return () =>
      container.isBound(ModelServiceContributionIdentifier)
        ? container.getAll<ModelServiceContribution>(
            ModelServiceContributionIdentifier
          )
        : [];
  });

  bind(ModelHubProvider).toProvider(({ container }) => {
    return async (context: string) => {
      const modelHubManager = container.get<ModelHubManager>(ModelHubManager);
      return modelHubManager.provideModelHub(context);
    };
  });

  // This binding only works in containers (usually child containers)
  // that have the required ModelHubContext binding.
  // Note that this binding is not a singleton because
  //  - it would be hoisted to the parent container and so
  //    become the only hub that can ever be injected and
  //  - the singleton ModelHubManager already implements
  //    an effective singleton hub per context
  bind(ModelHub).toDynamicValue(({ container }) => {
    const boundContext = container.get(ModelHubContext) as string;
    const modelHubManager = container.get<ModelHubManager>(ModelHubManager);
    const modelHub = modelHubManager.getModelHub(boundContext);
    modelHubManager.initializeContext(boundContext);
    return modelHub;
  });

  bind(ModelHubServer).toSelf().inSingletonScope();
  bind(ConnectionHandler)
    .toDynamicValue(
      ({ container }) =>
        new RpcConnectionHandler<ModelHubClient>(
          ModelHubProtocolServicePath,
          (client) => {
            const server = container.get<ModelHubServer>(ModelHubServer);
            server.setClient(client);
            return server;
          }
        )
    )
    .inSingletonScope();

  bind(ModelAccessorBusServer).toSelf().inSingletonScope();
  bind(ConnectionHandler)
    .toDynamicValue(
      ({ container }) =>
        new RpcConnectionHandler<ModelAccessorBusClient>(
          ModelAccessorBusProtocolServicePath,
          (client) => {
            const server = container.get<ModelAccessorBusServer>(
              ModelAccessorBusServer
            );
            server.setClient(client);
            return server;
          }
        )
    )
    .inSingletonScope();

  bindContributionProvider(bind, ModelHubLifecycleContribution);
});
