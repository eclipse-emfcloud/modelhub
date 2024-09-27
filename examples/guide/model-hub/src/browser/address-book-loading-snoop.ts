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
  FrontendModelHub,
  FrontendModelHubProvider,
} from '@eclipse-emfcloud/model-service-theia/lib/browser';
import { Disposable, DisposableCollection } from '@theia/core';
import {
  inject,
  injectable,
  postConstruct,
} from '@theia/core/shared/inversify';
import { AddressBook, isAddressBookModelId } from '../common';

const modelHubContextId = 'address-books';

@injectable()
export class AddressBookLoadingSnoop {
  @inject(FrontendModelHubProvider)
  private readonly modelHubProvider: FrontendModelHubProvider<string>;

  private toDispose = new DisposableCollection();

  @postConstruct()
  initialize(): void {
    this.modelHubProvider(modelHubContextId).then(
      async (modelHub: FrontendModelHub<string>) => {
        const subscription = await modelHub.subscribe();
        this.toDispose.push(Disposable.create(() => subscription.close()));
        subscription.onModelLoaded = async (modelId: string) => {
          if (!isAddressBookModelId(modelId)) {
            return;
          }
          const addressBook = await modelHub.getModel<AddressBook>(modelId);
          console.log(
            `An address book was loaded with ID '${modelId}':`,
            addressBook
          );
        };
      }
    );
  }
}
