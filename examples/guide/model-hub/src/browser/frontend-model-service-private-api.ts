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
import { inject, injectable } from '@theia/core/shared/inversify';
import { Address, AddressEntry } from '../common';
import {
  AddressBookPrivateAPI,
  AddressBookPrivateAPIProtocol,
} from '../common/model-service-private-api';

export const AddressBookPrivateApiFactory = Symbol(
  'Factory<string, AddressBookPrivateAPI>'
);
export type AddressBookPrivateApiFactory = (
  context: string
) => AddressBookPrivateAPI;

@injectable()
export class FrontendAddressBookPrivateAPI implements AddressBookPrivateAPI {
  @inject(ModelHubContext)
  public readonly context: string;

  @inject(AddressBookPrivateAPIProtocol)
  private readonly rpc: AddressBookPrivateAPIProtocol;

  findAddressEntry(
    modelId: string,
    lastNameRegex: string | undefined,
    firstNameRegex: string | undefined
  ): Promise<number | undefined> {
    return this.rpc.findAddressEntry(
      this.context,
      modelId,
      lastNameRegex,
      firstNameRegex
    );
  }

  getEditingAPI(commandStackId: string) {
    const rpc = this.rpc;
    const context = this.context;

    return {
      addEntry(modelId: string, entry: AddressEntry): Promise<void> {
        return rpc.addEntry(context, commandStackId, modelId, entry);
      },

      updateEntry(
        modelId: string,
        index: number,
        update: Partial<AddressEntry>
      ): Promise<void> {
        return rpc.updateEntry(context, commandStackId, modelId, index, update);
      },

      deleteEntry(modelId: string, index: number): Promise<void> {
        return rpc.deleteEntry(context, commandStackId, modelId, index);
      },

      addAddress(
        modelId: string,
        entryIndex: number,
        address: Address
      ): Promise<void> {
        return rpc.addAddress(
          context,
          commandStackId,
          modelId,
          entryIndex,
          address
        );
      },

      updateAddress(
        modelId: string,
        entryIndex: number,
        addressIndex: number,
        update: Partial<Address>
      ): Promise<void> {
        return rpc.updateAddress(
          context,
          commandStackId,
          modelId,
          entryIndex,
          addressIndex,
          update
        );
      },

      deleteAddress(
        modelId: string,
        entryIndex: number,
        addressIndex: number
      ): Promise<void> {
        return rpc.deleteAddress(
          context,
          commandStackId,
          modelId,
          entryIndex,
          addressIndex
        );
      },

      undo(): Promise<void> {
        return rpc.undo(context, commandStackId);
      },

      redo(): Promise<void> {
        return rpc.redo(context, commandStackId);
      },

      save(): Promise<boolean> {
        return rpc.save(context, commandStackId);
      },
    };
  }
}
