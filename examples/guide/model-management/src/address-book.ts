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

export type AddressBook = {
  entries: {
    lastName: string;
    firstName: string;
    addresses: {
      kind: 'home' | 'work' | 'other';
      numberAndStreet: string;
      unit?: string;
      city: string;
      province?: string;
      state?: string;
      otherAdministrativeSubdivision?: string;
      country: string;
    }[];
  }[];
};

export type AddressEntry = AddressBook['entries'][number];
export type Address = AddressEntry['addresses'][number];
export type AddressKind = Address['kind'];
export type JSONPointer = string;

export const AddressBookModelID = '@example/address-book';

export function isAddressBookModelId(modelId: string): boolean {
  return modelId.startsWith('example:') && modelId.endsWith('.addressbook');
}

export function isAddressBook(input: unknown): input is AddressBook {
  // In a real implementation this should check the shape of the content, perhaps using Zod.
  return (
    !!input &&
    typeof input === 'object' &&
    'entries' in input &&
    Array.isArray(input.entries)
  );
}

export function getAddressBookEntryWithPointer(
  addressBook: AddressBook,
  lastName: string,
  firstName: string
): [AddressEntry, JSONPointer] | undefined {
  const index = addressBook.entries.findIndex(
    (entry) => entry.lastName === lastName && entry.firstName === firstName
  );
  if (index >= 0) {
    return [addressBook.entries[index], `/entries/${index}`];
  }
  return undefined;
}
