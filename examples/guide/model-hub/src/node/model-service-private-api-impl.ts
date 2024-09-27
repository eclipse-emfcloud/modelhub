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
  ModelManager,
  createModelUpdaterCommand,
} from '@eclipse-emfcloud/model-manager';
import { ModelHub } from '@eclipse-emfcloud/model-service';
import { Address, AddressBook, AddressEntry } from '../common';
import {
  AddressBookPrivateAPI,
  AddressBookPrivateAPIProtocol,
} from '../common/model-service-private-api';

import { injectable } from '@theia/core/shared/inversify';

export class AddressBookPrivateAPIImpl implements AddressBookPrivateAPI {
  constructor(
    readonly context: string,
    private readonly modelManager: ModelManager<string>,
    private readonly modelHub: ModelHub<string>
  ) {}

  async findAddressEntry(
    modelId: string,
    lastNameRegex: string | undefined,
    firstNameRegex: string | undefined
  ): Promise<number | undefined> {
    const addressBook = await this.modelHub.getModel<AddressBook>(modelId);
    if (!addressBook) {
      return undefined;
    }

    const lastName = new RegExp(lastNameRegex ?? '.*');
    const firstName = new RegExp(firstNameRegex ?? '.*');

    return addressBook.entries.findIndex(
      (entry) =>
        lastName.test(entry.lastName) && firstName.test(entry.firstName)
    );
  }

  getEditingAPI(commandStackId: string) {
    const modelHub = this.modelHub;
    const commandStack = this.modelManager.getCommandStack(commandStackId);

    return {
      async addEntry(modelId: string, entry: AddressEntry): Promise<void> {
        const command = createModelUpdaterCommand(
          'Add Entry',
          modelId,
          (model: AddressBook) => model.entries.push(entry)
        );
        await commandStack.execute(command);
      },

      async updateEntry(
        modelId: string,
        index: number,
        update: Partial<AddressEntry>
      ): Promise<void> {
        const command = createModelUpdaterCommand(
          'Update Entry',
          modelId,
          (model: AddressBook) => {
            const entry = model.entries[index];
            if (entry) {
              // Should only take properties of 'update' that are defined by AddressEntry
              Object.assign(model, update);
            }
          }
        );

        await commandStack.execute(command);
      },

      async deleteEntry(modelId: string, index: number): Promise<void> {
        const command = createModelUpdaterCommand(
          'Delete Entry',
          modelId,
          (model: AddressBook) => model.entries.splice(index, 1)
        );
        await commandStack.execute(command);
      },

      async addAddress(
        modelId: string,
        entryIndex: number,
        address: Address
      ): Promise<void> {
        const command = createModelUpdaterCommand(
          'Add Address',
          modelId,
          (model: AddressBook) => {
            const entry = model.entries[entryIndex];
            if (entry) {
              // Should only take properties of 'update' that are defined by AddressEntry
              Object.assign(entry, address);
            }
          }
        );
        await commandStack.execute(command);
      },

      async updateAddress(
        modelId: string,
        entryIndex: number,
        addressIndex: number,
        update: Partial<Address>
      ): Promise<void> {
        const command = createModelUpdaterCommand(
          'Update Entry',
          modelId,
          (model: AddressBook) => {
            const address =
              model.entries[entryIndex]?.addresses?.[addressIndex];
            if (address) {
              // Should only take properties of 'update' that are defined by Address
              Object.assign(address, update);
            }
          }
        );

        await commandStack.execute(command);
      },

      async deleteAddress(
        modelId: string,
        entryIndex: number,
        addressIndex: number
      ): Promise<void> {
        const command = createModelUpdaterCommand(
          'Delete Entry',
          modelId,
          (model: AddressBook) =>
            model.entries[entryIndex]?.addresses?.splice(addressIndex, 1)
        );
        await commandStack.execute(command);
      },

      async undo(): Promise<void> {
        await commandStack.undo();
      },

      async redo(): Promise<void> {
        await commandStack.redo();
      },

      save(): Promise<boolean> {
        return modelHub.save(commandStackId);
      },
    };
  }
}

@injectable()
export class AddressBookPrivateAPIServer
  implements AddressBookPrivateAPIProtocol
{
  private readonly privateApiByContext: Record<string, AddressBookPrivateAPI> =
    {};

  registerContext(context: string, privateAPI: AddressBookPrivateAPI): void {
    this.privateApiByContext[context] = privateAPI;
  }

  findAddressEntry(
    context: string,
    modelId: string,
    lastNameRegex: string,
    firstNameRegex: string
  ): Promise<number | undefined> {
    return this.privateApiByContext[context].findAddressEntry(
      modelId,
      lastNameRegex,
      firstNameRegex
    );
  }

  private getEditingAPI(context: string, commandStackId: string) {
    return this.privateApiByContext[context].getEditingAPI(commandStackId);
  }

  addEntry(
    context: string,
    commandStackId: string,
    modelId: string,
    entry: AddressEntry
  ): Promise<void> {
    return this.getEditingAPI(context, commandStackId).addEntry(modelId, entry);
  }

  updateEntry(
    context: string,
    commandStackId: string,
    modelId: string,
    index: number,
    update: Partial<AddressEntry>
  ): Promise<void> {
    return this.getEditingAPI(context, commandStackId).updateEntry(
      modelId,
      index,
      update
    );
  }

  deleteEntry(
    context: string,
    commandStackId: string,
    modelId: string,
    index: number
  ): Promise<void> {
    return this.getEditingAPI(context, commandStackId).deleteEntry(
      modelId,
      index
    );
  }

  addAddress(
    context: string,
    commandStackId: string,
    modelId: string,
    entryIndex: number,
    address: Address
  ): Promise<void> {
    return this.getEditingAPI(context, commandStackId).addAddress(
      modelId,
      entryIndex,
      address
    );
  }

  updateAddress(
    context: string,
    commandStackId: string,
    modelId: string,
    entryIndex: number,
    addressIndex: number,
    update: Partial<Address>
  ): Promise<void> {
    return this.getEditingAPI(context, commandStackId).updateAddress(
      modelId,
      entryIndex,
      addressIndex,
      update
    );
  }

  deleteAddress(
    context: string,
    commandStackId: string,
    modelId: string,
    entryIndex: number,
    addressIndex: number
  ): Promise<void> {
    return this.getEditingAPI(context, commandStackId).deleteAddress(
      modelId,
      entryIndex,
      addressIndex
    );
  }

  undo(context: string, commandStackId: string): Promise<void> {
    return this.getEditingAPI(context, commandStackId).undo();
  }

  redo(context: string, commandStackId: string): Promise<void> {
    return this.getEditingAPI(context, commandStackId).redo();
  }

  save(context: string, commandStackId: string): Promise<boolean> {
    return this.getEditingAPI(context, commandStackId).save();
  }
}
