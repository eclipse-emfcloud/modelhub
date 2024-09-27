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
  Command,
  ModelManager,
  append,
  createModelManager,
  createModelUpdaterCommand,
} from '@eclipse-emfcloud/model-manager';
import {
  Address,
  AddressBook,
  AddressEntry,
  getAddressBookEntryWithPointer,
} from './address-book';
import { PackageTracking, Shipment } from './package-tracking';

import { inspect } from './helpers';

process.on('rejectionHandled', () => undefined);
process.on('unhandledRejection', () => undefined);

function createModels() {
  const modelManager: ModelManager<string> = createModelManager();
  const contacts: AddressBook = {
    entries: [],
  };
  const packageTracking: PackageTracking = {
    shipments: [],
  };

  modelManager.setModel('example:contacts.addressbook', contacts);
  modelManager.setModel('example:packages.shipping', packageTracking);

  const addressBook = modelManager.getModel<AddressBook>(
    'example:contacts.addressbook'
  );
  console.log('Contacts address book:', inspect(addressBook));
  console.log('Package tracking:', inspect(packageTracking));

  // Contacts address book: { entries: [] }
  // Package tracking: { shipments: [] }

  return modelManager;
}

function createAddEntryCommand(entryToAdd: AddressEntry): Command {
  return createModelUpdaterCommand(
    'Add Entry',
    'example:contacts.addressbook',
    (model: AddressBook) => model.entries.push(entryToAdd)
  );
}

function createAddAddressCommand(
  lastName: string,
  firstName: string,
  addressToAdd: Address
): Command {
  return createModelUpdaterCommand(
    'Add Entry',
    'example:contacts.addressbook',
    (model: AddressBook) => {
      const [entryToUpdate, _] = getAddressBookEntryWithPointer(
        model,
        lastName,
        firstName
      )!;
      entryToUpdate.addresses.push(addressToAdd);
    }
  );
}

function createAddShipmentCommand(shipmentToAdd: Shipment): Command {
  return createModelUpdaterCommand(
    'Add Shipment',
    'example:packages.shipping',
    (model: PackageTracking) => model.shipments.push(shipmentToAdd)
  );
}

async function addShipmentWithNewDeliveryAddressBroken(
  modelManager: ModelManager<string>
) {
  const entryToAdd: AddressEntry = {
    lastName: 'Brown',
    firstName: 'Alice',
    addresses: [],
  };

  const addEntryCommand = createAddEntryCommand(entryToAdd);
  const addressBookStack = modelManager.getCommandStack('address-book');
  await addressBookStack.execute(addEntryCommand);

  let addressBook = modelManager.getModel<AddressBook>(
    'example:contacts.addressbook'
  );

  console.log('Contacts address book:', inspect(addressBook));

  // Contacts address book: {
  //   entries: [ { lastName: 'Brown', firstName: 'Alice', addresses: [] } ]
  // }

  const shipmentToAdd: Shipment = {
    recipient: {
      lastName: 'Brown',
      firstName: 'Alice',
    },
    shipTo: {
      numberAndStreet: '123 Front Street',
      city: 'Exampleville',
      province: 'Ontario',
      country: 'Canada',
    },
  };

  const addShipmentCommand = createAddShipmentCommand(shipmentToAdd);
  const addDeliveryAddressCommand = createAddAddressCommand(
    shipmentToAdd.recipient.lastName,
    shipmentToAdd.recipient.firstName,
    { kind: 'home', ...shipmentToAdd.shipTo }
  );
  const addShipmentAndDeliveryAddressCommand = append(
    addShipmentCommand,
    addDeliveryAddressCommand
  );
  const packageTrackingStack = modelManager.getCommandStack('package-tracking');
  await packageTrackingStack.execute(addShipmentAndDeliveryAddressCommand);

  addressBook = modelManager.getModel<AddressBook>(
    'example:contacts.addressbook'
  );
  const packageTracking = modelManager.getModel<PackageTracking>(
    'example:packages.shipping'
  );

  console.log('Contacts address book:', inspect(addressBook));
  console.log('Package tracking:', inspect(packageTracking));

  // Contacts address book: {
  //   entries: [
  //     {
  //       lastName: 'Brown',
  //       firstName: 'Alice',
  //       addresses: [
  //         {
  //           kind: 'home',
  //           numberAndStreet: '123 Front Street',
  //           city: 'Exampleville',
  //           province: 'Ontario',
  //           country: 'Canada'
  //         }
  //       ]
  //     }
  //   ]
  // }
  // Package tracking: {
  //   shipments: [
  //     {
  //       recipient: { lastName: 'Brown', firstName: 'Alice' },
  //       shipTo: {
  //         numberAndStreet: '123 Front Street',
  //         city: 'Exampleville',
  //         province: 'Ontario',
  //         country: 'Canada'
  //       }
  //     }
  //   ]
  // }

  await addressBookStack
    .undo()
    .catch((error) => console.error('Undo failed:', error.message));

  // Undo failed: Test operation failed
  // name: TEST_OPERATION_FAILED
  // index: 0
  // operation: {
  //   "op": "test",
  //   "path": "/entries/0",
  //   "value": {
  //     "lastName": "Brown",
  //     "firstName": "Alice",
  //     "addresses": []
  //   }
  // }
  // tree: {
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

async function addShipmentWithNewDeliveryAddressFixed(
  modelManager: ModelManager<string>
) {
  const entryToAdd: AddressEntry = {
    lastName: 'Brown',
    firstName: 'Alice',
    addresses: [],
  };

  const shipmentToAdd: Shipment = {
    recipient: {
      lastName: 'Brown',
      firstName: 'Alice',
    },
    shipTo: {
      numberAndStreet: '123 Front Street',
      city: 'Exampleville',
      province: 'Ontario',
      country: 'Canada',
    },
  };

  const addEntryCommand = createAddEntryCommand(entryToAdd);
  const addressBookStack = modelManager.getCommandStack('address-book');
  await addressBookStack.execute(addEntryCommand);

  const addShipmentCommand = createAddShipmentCommand(shipmentToAdd);
  const addDeliveryAddressCommand = createAddAddressCommand(
    shipmentToAdd.recipient.lastName,
    shipmentToAdd.recipient.firstName,
    { kind: 'home', ...shipmentToAdd.shipTo }
  );
  const addShipmentAndDeliveryAddressCommand = append(
    addShipmentCommand,
    addDeliveryAddressCommand
  );
  const packageTrackingStack = modelManager.getCommandStack('package-tracking');
  const coreStack = packageTrackingStack.getCoreCommandStack();
  await coreStack.execute(
    addShipmentAndDeliveryAddressCommand,
    'address-book',
    'package-tracking'
  );

  let addressBook = modelManager.getModel<AddressBook>(
    'example:contacts.addressbook'
  );
  let packageTracking = modelManager.getModel<PackageTracking>(
    'example:packages.shipping'
  );

  console.log('Contacts address book:', inspect(addressBook));
  console.log('Package tracking:', inspect(packageTracking));

  // Contacts address book: {
  //   entries: [
  //     {
  //       lastName: 'Brown',
  //       firstName: 'Alice',
  //       addresses: [
  //         {
  //           kind: 'home',
  //           numberAndStreet: '123 Front Street',
  //           city: 'Exampleville',
  //           province: 'Ontario',
  //           country: 'Canada'
  //         }
  //       ]
  //     }
  //   ]
  // }
  // Package tracking: {
  //   shipments: [
  //     {
  //       recipient: { lastName: 'Brown', firstName: 'Alice' },
  //       shipTo: {
  //         numberAndStreet: '123 Front Street',
  //         city: 'Exampleville',
  //         province: 'Ontario',
  //         country: 'Canada'
  //       }
  //     }
  //   ]
  // }

  await addressBookStack
    .undo()
    .catch((error) => console.error('Undo failed:', error.message));

  addressBook = modelManager.getModel<AddressBook>(
    'example:contacts.addressbook'
  );
  packageTracking = modelManager.getModel<PackageTracking>(
    'example:packages.shipping'
  );

  console.log('Contacts address book:', inspect(addressBook));
  console.log('Package tracking:', inspect(packageTracking));

  // Contacts address book: {
  //   entries: [ { lastName: 'Brown', firstName: 'Alice', addresses: [] } ]
  // }
  // Package tracking: { shipments: [] }

  await addressBookStack
    .undo()
    .catch((error) => console.error('Undo failed:', error.message));

  addressBook = modelManager.getModel<AddressBook>(
    'example:contacts.addressbook'
  );
  packageTracking = modelManager.getModel<PackageTracking>(
    'example:packages.shipping'
  );

  console.log('Contacts address book:', inspect(addressBook));
  console.log('Package tracking:', inspect(packageTracking));

  // Contacts address book: { entries: [] }
  // Package tracking: { shipments: [] }

  const canRedoPackageTracking = await packageTrackingStack.canRedo();
  console.log(
    'Can redo the Package Tracking command stack?',
    canRedoPackageTracking
  );

  // Can redo the Package Tracking command stack? true

  const analysis = await coreStack.analyzeRedo('package-tracking');
  const redoDependencies = new Set(Object.keys(analysis.contexts));
  redoDependencies.delete('package-tracking');
  console.log(
    'But redo has dependencies on other stacks (editing contexts):',
    inspect(Array.from(redoDependencies))
  );
  console.log('Detailed analysis:', inspect(analysis));

  // But redo has dependencies on other stacks (editing contexts): [ 'address-book' ]
  // Detailed analysis: {
  //   canRedo: true,
  //   hasDependencies: true,
  //   summary: "The redo command of context 'package-tracking' is redoable.",
  //   contexts: { 'package-tracking': true, 'address-book': true }
  // }

  await packageTrackingStack.redo();

  addressBook = modelManager.getModel<AddressBook>(
    'example:contacts.addressbook'
  );
  packageTracking = modelManager.getModel<PackageTracking>(
    'example:packages.shipping'
  );

  console.log('Contacts address book:', inspect(addressBook));
  console.log('Package tracking:', inspect(packageTracking));

  // Contacts address book: {
  //   entries: [
  //     {
  //       lastName: 'Brown',
  //       firstName: 'Alice',
  //       addresses: [
  //         {
  //           kind: 'home',
  //           numberAndStreet: '123 Front Street',
  //           city: 'Exampleville',
  //           province: 'Ontario',
  //           country: 'Canada'
  //         }
  //       ]
  //     }
  //   ]
  // }
  // Package tracking: {
  //   shipments: [
  //     {
  //       recipient: { lastName: 'Brown', firstName: 'Alice' },
  //       shipTo: {
  //         numberAndStreet: '123 Front Street',
  //         city: 'Exampleville',
  //         province: 'Ontario',
  //         country: 'Canada'
  //       }
  //     }
  //   ]
  // }

  await addressBookStack.undo();

  addressBook = modelManager.getModel<AddressBook>(
    'example:contacts.addressbook'
  );
  packageTracking = modelManager.getModel<PackageTracking>(
    'example:packages.shipping'
  );

  console.log('Contacts address book:', inspect(addressBook));
  console.log('Package tracking:', inspect(packageTracking));

  // Contacts address book: { entries: [] }
  // Package tracking: { shipments: [] }
}

function subscribe(modelManager: ModelManager<string>) {
  const commandStack = modelManager.getCommandStack('main');
  const sub = commandStack.subscribe();

  sub.onCommandStackChanged = (eventType, command) => {
    const eventDetail = command ? ` affecting command '${command.label}'` : '';
    console.log(
      `On command stack 'main' the '${eventType}' event occurred${eventDetail}.`
    );
  };
  sub.onDirtyStateChanged = (dirtyStateChanges) => {
    console.log(
      "On command stack 'main' the following models changed dirty state:"
    );
    for (const [modelId, dirty] of dirtyStateChanges) {
      const eventDetail = dirty ? 'dirty' : 'clean';
      console.log(`  Model '${modelId}' is ${eventDetail}.`);
    }
  };

  return () => sub.close();
}

async function commandStackSubscription(modelManager: ModelManager<string>) {
  const dispose = subscribe(modelManager);

  const command = createAddEntryCommand({
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
  });
  const commandStack = modelManager.getCommandStack('main');
  await commandStack.execute(command);

  // On command stack 'main' the 'executed' event occurred affecting command 'Add Entry'.
  // On command stack 'main' the following models changed dirty state:
  //   Model 'example:contacts.addressbook' is dirty.

  commandStack.markSaved();

  // On command stack 'main' the following models changed dirty state:
  //   Model 'example:contacts.addressbook' is clean.

  await commandStack.undo();

  // On command stack 'main' the 'undone' event occurred affecting command 'Add Entry'.
  // On command stack 'main' the following models changed dirty state:
  //   Model 'example:contacts.addressbook' is dirty.

  await commandStack.redo();

  // On command stack 'main' the 'redone' event occurred affecting command 'Add Entry'.
  // On command stack 'main' the following models changed dirty state:
  //   Model 'example:contacts.addressbook' is clean.

  commandStack.flush();

  // On command stack 'main' the 'flushed' event occurred.

  dispose();
}

async function main() {
  let modelManager = createModels();
  await addShipmentWithNewDeliveryAddressBroken(modelManager);

  modelManager = createModels();
  await addShipmentWithNewDeliveryAddressFixed(modelManager);

  modelManager = createModels();
  await commandStackSubscription(modelManager);
}

main();
