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
  CommandStack,
  ModelManager,
  createModelManager,
  createModelUpdaterCommandWithResult,
} from '@eclipse-emfcloud/model-manager';
import { AddressBook, AddressEntry } from './address-book';

import { sortedIndexBy } from 'lodash';
import { inspect } from './helpers';

function createAddressBookModel() {
  const modelManager: ModelManager<string> = createModelManager();
  const contacts: AddressBook = {
    entries: [],
  };

  modelManager.setModel('example:contacts.addressbook', contacts);

  const addressBook = modelManager.getModel<AddressBook>(
    'example:contacts.addressbook'
  );
  console.log('Contacts address book:', inspect(addressBook));

  // Contacts address book: {
  //   "entries": []
  // }

  return modelManager;
}

async function addEntryToAddressBook(modelManager: ModelManager<string>) {
  const alice: AddressEntry = {
    lastName: 'Brown',
    firstName: 'Alice',
    addresses: [
      {
        kind: 'home',
        numberAndStreet: '123 Front Street',
        city: 'Exampleville',
        province: 'Ontario',
        country: 'Canada',
      },
    ],
  };

  const addAddressEntry = (entryToAdd: AddressEntry) =>
    createModelUpdaterCommandWithResult(
      'Add Entry',
      'example:contacts.addressbook',
      (model: AddressBook) => {
        const index = sortedIndexBy(
          model.entries,
          entryToAdd,
          (item) =>
            item.lastName.localeCompare(entryToAdd.lastName) ||
            item.firstName.localeCompare(entryToAdd.firstName)
        );
        model.entries.splice(index, 0, entryToAdd);
        return { index };
      }
    );

  let addressBook = modelManager.getModel<AddressBook>(
    'example:contacts.addressbook'
  );

  const stack: CommandStack<string> = modelManager.getCommandStack('main');

  const addAlice = addAddressEntry(alice);
  await stack.execute(addAlice);
  console.log('Inserted entry at index', addAlice.result!.index);
  console.log('Contacts address book:', inspect(addressBook));

  // Inserted entry at index 0
  // Contacts address book: {
  //   "entries": []
  // }

  addressBook = modelManager.getModel<AddressBook>(
    'example:contacts.addressbook'
  );
  console.log('Updated contacts address book:', inspect(addressBook));

  // Updated contacts address book: {
  //   "entries": [
  //     {
  //       "lastName": "Brown",
  //       "firstName": "Alice",
  //       "addresses": [
  //         {
  //           "kind": "home",
  //           "numberAndStreet": "123 Front Street",
  //           "city": "Exampleville",
  //           "province": "Ontario",
  //           "country": "Canada"
  //         }
  //       ]
  //     }
  //   ]
  // }
}

async function undoAddedEntry(modelManager: ModelManager<string>) {
  const stack: CommandStack<string> = modelManager.getCommandStack('main');

  console.log('Can undo?', await stack.canUndo());
  await stack.undo();
  const addressBook = modelManager.getModel<AddressBook>(
    'example:contacts.addressbook'
  );
  console.log('Unedited address book:', inspect(addressBook));

  // Can undo? true
  // Unedited address book: {
  //   "entries": []
  // }
}

async function redoAddedEntry(modelManager: ModelManager<string>) {
  const stack: CommandStack<string> = modelManager.getCommandStack('main');

  console.log('Can undo?', await stack.canUndo());
  console.log('Can redo?', await stack.canRedo());
  await stack.redo();
  const addressBook = modelManager.getModel<AddressBook>(
    'example:contacts.addressbook'
  );
  console.log('Re-edited address book:', inspect(addressBook));

  // Can undo? false
  // Can redo? true
  // Re-edited address book: {
  //   "entries": [
  //     {
  //       "lastName": "Brown",
  //       "firstName": "Alice",
  //       "addresses": [
  //         {
  //           "kind": "home",
  //           "numberAndStreet": "123 Front Street",
  //           "city": "Exampleville",
  //           "province": "Ontario",
  //           "country": "Canada"
  //         }
  //       ]
  //     }
  //   ]
  // }
}

async function main() {
  const modelManager = createAddressBookModel();
  await addEntryToAddressBook(modelManager);
  await undoAddedEntry(modelManager);
  await redoAddedEntry(modelManager);
}

main();
