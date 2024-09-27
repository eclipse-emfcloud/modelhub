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
  FrontendModelAccessorBus,
  FrontendModelHubProvider,
} from '@eclipse-emfcloud/model-service-theia/lib/browser';
import { ReactWidget } from '@theia/core/lib/browser';
import {
  inject,
  injectable,
  postConstruct,
} from '@theia/core/shared/inversify';
import * as React from 'react';
import { v4 as uuid } from 'uuid';
import {
  AddressBook,
  AddressBookMyAddressesProviderResult,
  Project,
} from '../common';
import { AddressBookPrivateAPI } from '../common/model-service-private-api';
import { SomeAddress } from '../node/model-service-api';
import { AddressBookPrivateApiFactory } from './frontend-model-service-private-api';

@injectable()
export class AddressBookWidget extends ReactWidget {
  @inject(Project)
  protected readonly project: Project;

  @inject(FrontendModelHubProvider)
  protected readonly modelHubProvider: FrontendModelHubProvider<string>;

  @inject(AddressBookPrivateApiFactory)
  private readonly privateApiFactory: AddressBookPrivateApiFactory;

  private api: AddressBookPrivateAPI;
  private commandStackId: string;
  private frontendModelAccessorBus: FrontendModelAccessorBus;
  private currentAddressBook: AddressBook;

  @postConstruct()
  initialize(): void {
    this.api = this.privateApiFactory(this.project.name);
    this.commandStackId = uuid();
    // Initialize Frontend Model Accessor Bus
    this.modelHubProvider(this.project.name)
      .then(async (frontendModelHub) => {
        // Get the FrontendModelAccessorBus
        this.frontendModelAccessorBus = frontendModelHub.getModelAccessorBus();

        // Initialize a reference address book.
        this.currentAddressBook = await frontendModelHub.getModel<AddressBook>(
          this.project.name
        );

        // Subscribe to FrontendModelAccessorBus
        this.subscribe();
      })
      .catch((err) => console.error(err));
  }

  protected subscribe() {
    this.frontendModelAccessorBus.subscribe(
      'addressbook.my-main-address-changed',
      async (accessorId) => {
        // Iterate on each entry to call the Provider
        this.currentAddressBook.entries.forEach(async (entry) => {
          // Use the Provider `get` function to retrieve the list of my-addresses for this entry
          const updatedMyAddresses =
            await this.frontendModelAccessorBus.get<AddressBookMyAddressesProviderResult>(
              accessorId,
              entry.firstName,
              entry.lastName
            );

          if (updatedMyAddresses) {
            //
            // Search for changes between the saved model and the list of addresses
            // Or just update the displayed the data
            //
          }
        });
      }
    );
  }

  protected render(): React.ReactNode {
    return (
      <>
        {
          //
          // UI features
          //
        }
      </>
    );
  }

  protected async addEntry(
    modelId: string,
    lastName: string,
    firstName: string,
    address: SomeAddress
  ) {
    const existingEntryIndex = await this.api.findAddressEntry(
      modelId,
      lastName,
      firstName
    );

    const editingAPI = this.api.getEditingAPI(this.commandStackId);
    if (existingEntryIndex !== undefined) {
      editingAPI
        .addAddress(modelId, existingEntryIndex, address)
        .then(() => editingAPI.save()); // Save a successful edit
    } else {
      editingAPI
        .addEntry(modelId, {
          lastName,
          firstName,
          addresses: [address],
        })
        .then(() => editingAPI.save()); // Save a successful edit
    }
  }
}
