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
import { Address, AddressEntry } from './index';

export type AddressBookPrivateAPI = {
  readonly context: string;
  findAddressEntry(
    modelId: string,
    lastNameRegex: string | undefined,
    firstNameRegex: string | undefined
  ): Promise<number | undefined>;
  getEditingAPI(commandStackId: string): {
    addEntry(modelId: string, entry: AddressEntry): Promise<void>;
    updateEntry(
      modelId: string,
      index: number,
      update: Partial<AddressEntry>
    ): Promise<void>;
    deleteEntry(modelId: string, index: number): Promise<void>;
    addAddress(
      modelId: string,
      entryIndex: number,
      address: Address
    ): Promise<void>;
    updateAddress(
      modelId: string,
      entryIndex: number,
      addressIndex: number,
      update: Partial<Address>
    ): Promise<void>;
    deleteAddress(
      modelId: string,
      entryIndex: number,
      addressIndex: number
    ): Promise<void>;
    undo(): Promise<void>;
    redo(): Promise<void>;
    save(): Promise<boolean>;
  };
};

export const AddressBookPrivateAPIProtocol = Symbol(
  'AddressBookPrivateAPIProtocol'
);

export type AddressBookPrivateAPIBaseProtocol = {
  [Method in keyof Omit<AddressBookPrivateAPI, 'context' | 'getEditingAPI'>]: (
    context: string,
    ...args: Parameters<AddressBookPrivateAPI[Method]>
  ) => ReturnType<AddressBookPrivateAPI[Method]>;
};

type AddressBookPrivateEditingAPI = ReturnType<
  AddressBookPrivateAPI['getEditingAPI']
>;
export type AddressBookPrivateAPIEditingProtocol = {
  [Method in keyof AddressBookPrivateEditingAPI]: (
    context: string,
    commandStackId: string,
    ...args: Parameters<AddressBookPrivateEditingAPI[Method]>
  ) => ReturnType<AddressBookPrivateEditingAPI[Method]>;
};

export const AddressBookPrivateApiPath = '/services/address-book/private-api';
export type AddressBookPrivateAPIProtocol = AddressBookPrivateAPIBaseProtocol &
  AddressBookPrivateAPIEditingProtocol;
