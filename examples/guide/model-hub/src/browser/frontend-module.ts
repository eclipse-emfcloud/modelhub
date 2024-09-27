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
import { ModelHubContext } from '@eclipse-emfcloud/model-service-theia/lib/common';
import { WebSocketConnectionProvider } from '@theia/core/lib/browser';
import { ContainerModule } from '@theia/core/shared/inversify';
import {
  AddressBookPrivateAPI,
  AddressBookPrivateApiPath,
  AddressBookPrivateAPIProtocol,
} from '../common/model-service-private-api';
import {
  AddressBookPrivateApiFactory,
  FrontendAddressBookPrivateAPI,
} from './frontend-model-service-private-api';

export default new ContainerModule((bind) => {
  bind(FrontendAddressBookPrivateAPI).toSelf();
  bind(AddressBookPrivateApiFactory).toFactory(
    ({ container }) =>
      (context: string): AddressBookPrivateAPI => {
        const child = container.createChild();
        child.bind(ModelHubContext).toConstantValue(context);
        return child.get(FrontendAddressBookPrivateAPI);
      }
  );

  bind(AddressBookPrivateAPIProtocol)
    .toDynamicValue(({ container }) => {
      const connection = container.get(WebSocketConnectionProvider);
      return connection.createProxy<AddressBookPrivateAPIProtocol>(
        AddressBookPrivateApiPath
      );
    })
    .inSingletonScope();
});
