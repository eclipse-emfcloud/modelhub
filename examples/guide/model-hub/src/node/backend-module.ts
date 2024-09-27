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
import { ModelServiceContribution } from '@eclipse-emfcloud/model-service-theia/lib/node/';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core';
import { ContainerModule, interfaces } from '@theia/core/shared/inversify';

import { ModelHubContext } from '@eclipse-emfcloud/model-service-theia/lib/common/';
import { Project } from '../common';
import { AddressBookPrivateApiPath } from '../common/model-service-private-api';
import {
  DefaultProjectManager,
  ProjectAddressBook,
  ProjectContainerFactory,
  ProjectManager,
} from './address-book-consumer';
import { AddressBookModelServiceContribution } from './address-book-contribution';
import { AddressBookPrivateAPIServer } from './model-service-private-api-impl';

export default new ContainerModule((bind) => {
  bind(ModelServiceContribution).to(AddressBookModelServiceContribution);
  bind(ProjectManager).to(DefaultProjectManager).inSingletonScope();

  bind(ProjectContainerFactory).toFactory(({ container }) => {
    const childContainers: Record<string, interfaces.Container> = {};
    return (project: Project) => {
      if (project.name in childContainers) {
        return childContainers[project.name];
      }
      const child = container.createChild();
      childContainers[project.name] = child;
      child.bind(Project).toConstantValue(project);
      child.bind(ModelHubContext).toConstantValue(project.name);
      child.bind(ProjectAddressBook).toSelf();
      return child;
    };
  });

  bind(AddressBookPrivateAPIServer).toSelf().inSingletonScope();
  bind(ConnectionHandler)
    .toDynamicValue(
      ({ container }) =>
        new JsonRpcConnectionHandler(AddressBookPrivateApiPath, () => {
          const server = container.get(AddressBookPrivateAPIServer);
          return server;
        })
    )
    .inSingletonScope();
});
