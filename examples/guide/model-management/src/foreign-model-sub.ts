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
import { AddOperation, getValueByPointer } from 'fast-json-patch';
import { eq as deepEqual } from 'lodash';
import {
  Address,
  AddressBook,
  AddressEntry,
  getAddressBookEntryWithPointer,
} from './address-book';
import { PackageTracking, Shipment } from './package-tracking';

import { afterAsyncs, inspect } from './helpers';

// Simulate the retrieval of the new package details from the UI editing the model.
function getNewShipment(_packages: PackageTracking) {
  return {
    recipient: { lastName: 'Brown', firstName: 'Alice' },
    shipTo: {
      numberAndStreet: '123 Front Street',
      city: 'Exampleville',
      province: 'Ontario',
      country: 'Canada',
    },
  };
}

function createPackageTrackingModel() {
  const modelManager: ModelManager<string> = createModelManager();
  modelManager.setModel('example:packages.shipping', { shipments: [] });
  modelManager.setModel('example:contacts.addressbook', {
    entries: [{ lastName: 'Brown', firstName: 'Alice', addresses: [] }],
  });
  return modelManager;
}

function getAddShipmentCommand(shipment: Shipment): Command<string> {
  const addShipment = createModelUpdaterCommand(
    'Add Shipment',
    'example:packages.shipping',
    (model: PackageTracking) => model.shipments.push(shipment)
  );

  return addShipment;
}

function hasContactAddress(
  modelManager: ModelManager<string>,
  shipment: Shipment
) {
  const contacts = modelManager.getModel<AddressBook>(
    'example:contacts.addressbook'
  )!;
  const entry = getAddressBookEntryWithPointer(
    contacts,
    shipment.recipient.lastName,
    shipment.recipient.firstName
  )?.[0];
  return (
    !!entry &&
    entry.addresses.some((addr) => {
      const { kind: _, ...withoutKind } = addr;
      return deepEqual(withoutKind, shipment.shipTo);
    })
  );
}

function getAddAddressToContactsCommand(
  modelManager: ModelManager<string>,
  shipment: Shipment
): Command<string> | undefined {
  const contacts = modelManager.getModel<AddressBook>(
    'example:contacts.addressbook'
  )!;

  // See whether the Address Book entry for the recipient needs the shipping address to be added
  const [abEntry, abPointer] = getAddressBookEntryWithPointer(
    contacts,
    shipment.recipient.lastName,
    shipment.recipient.firstName
  ) ?? [undefined, undefined];
  const existingAddress = abEntry
    ? abEntry.addresses.find((addr) => {
        const { kind: _, ...withoutKind } = addr;
        return deepEqual(withoutKind, shipment.shipTo);
      })
    : undefined;
  if (!abEntry) {
    // Need to add the contact entry
    const entry: AddressEntry = {
      ...shipment.recipient,
      addresses: [{ ...shipment.shipTo, kind: 'work' }],
    };
    const addEntry = createModelUpdaterCommand(
      'Contact Sync',
      'example:contacts.addressbook',
      (model: AddressBook) => model.entries.push(entry)
    );
    return addEntry;
  } else if (!existingAddress) {
    // Need to add it. Add it as a work address
    const shippingAddress: Address = { ...shipment.shipTo, kind: 'work' };
    const addAddress = createModelUpdaterCommand(
      'Contact Sync',
      'example:contacts.addressbook',
      (model: AddressBook) => {
        const entry = getValueByPointer(model, abPointer!) as AddressEntry;
        entry.addresses.push(shippingAddress);
      }
    );
    return addAddress;
  }

  return undefined;
}

function subscribeToPackageTrackingModel(modelManager: ModelManager<string>) {
  const packagesSub = modelManager.subscribe('example:packages.shipping');
  packagesSub.onModelChanged = async (_modelId, _model, delta) => {
    if (!delta) {
      return;
    }

    const command = delta
      .filter((op) => op.op === 'add')
      .filter((op) => /\/shipments\/\d+/.test(op.path))
      .map((op) => op as AddOperation<Shipment>)
      .filter((op) => !hasContactAddress(modelManager, op.value as Shipment))
      .map(
        (op) =>
          getAddAddressToContactsCommand(modelManager, op.value as Shipment)!
      )
      .reduce((prev, curr) => append(prev, curr));
    if (command) {
      const stack = modelManager.getCommandStack('dependency-sync', {
        keepHistory: false,
      });
      if (await stack.canExecute(command)) {
        stack.execute(command);
      }
    }
  };

  return packagesSub;
}

async function addShipment(
  modelManager: ModelManager<string>,
  shipment: Shipment
) {
  const stack = modelManager.getCommandStack('main');
  const addShipment = getAddShipmentCommand(shipment);
  return stack.execute(addShipment);
}

async function main() {
  const modelManager = createPackageTrackingModel();

  function dumpModels() {
    const packageTracking = modelManager.getModel<PackageTracking>(
      'example:packages.shipping'
    );
    console.log('Package Tracking:', inspect(packageTracking));
    const contacts = modelManager.getModel<AddressBook>(
      'example:contacts.addressbook'
    );
    console.log('Contacts:', inspect(contacts));
  }

  dumpModels();

  // Package Tracking: { shipments: [] }
  // Contacts: {
  //   entries: [ { lastName: 'Brown', firstName: 'Alice', addresses: [] } ]
  // }

  // Get the Shipment that the user is configuring
  const packages = modelManager.getModel<PackageTracking>(
    'example:packages.shipping'
  )!;
  const shipment = getNewShipment(packages);

  const packagesSub = subscribeToPackageTrackingModel(modelManager);

  await addShipment(modelManager, shipment);

  afterAsyncs(dumpModels);

  // Package Tracking: {
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
  // Contacts: {
  //   entries: [
  //     {
  //       lastName: 'Brown',
  //       firstName: 'Alice',
  //       addresses: [
  //         {
  //           numberAndStreet: '123 Front Street',
  //           city: 'Exampleville',
  //           province: 'Ontario',
  //           country: 'Canada',
  //           kind: 'work'
  //         }
  //       ]
  //     }
  //   ]
  // }

  afterAsyncs(() => packagesSub.close());
}

main();
