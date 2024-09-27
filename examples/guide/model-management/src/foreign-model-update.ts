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
  CommandStack,
  ModelManager,
  append,
  createModelManager,
  createModelUpdaterCommand,
  isCompoundCommand,
} from '@eclipse-emfcloud/model-manager';
import { getValueByPointer } from 'fast-json-patch';
import { eq as deepEqual } from 'lodash';
import {
  Address,
  AddressBook,
  AddressEntry,
  getAddressBookEntryWithPointer,
} from './address-book';
import { PackageTracking, Shipment } from './package-tracking';

import { inspect } from './helpers';

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

function getAddAddressToContactsCommand(
  modelManager: ModelManager<string>,
  shipment: Shipment
) {
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

  if (!existingAddress) {
    // Need to add it. Add it as a work address
    const shippingAddress: Address = { ...shipment.shipTo, kind: 'work' };
    const addAddress = createModelUpdaterCommand(
      'Add Shipping Address',
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

async function addShipment(
  modelManager: ModelManager<string>,
  shipment: Shipment
) {
  const stack: CommandStack<string> = modelManager.getCommandStack('main');
  let addShipment = getAddShipmentCommand(shipment);
  const addAddress = getAddAddressToContactsCommand(modelManager, shipment);
  if (addAddress) {
    addShipment = append(addShipment, addAddress);
  }
  const delta = await stack.execute(addShipment);

  if (delta) {
    for (const [cmd, patch] of delta) {
      if (!isCompoundCommand(cmd)) {
        console.log('Model update:', cmd.modelId, inspect(patch));
      }
    }
  }

  // Model update: example:packages.shipping [
  //   {
  //     op: 'add',
  //     path: '/shipments/0',
  //     value: {
  //       recipient: { lastName: 'Brown', firstName: 'Alice' },
  //       shipTo: {
  //         numberAndStreet: '123 Front Street',
  //         city: 'Exampleville',
  //         province: 'Ontario',
  //         country: 'Canada'
  //       }
  //     }
  //   }
  // ]
  // Model update: example:contacts.addressbook [
  //   {
  //     op: 'add',
  //     path: '/entries/0/addresses/0',
  //     value: {
  //       numberAndStreet: '123 Front Street',
  //       city: 'Exampleville',
  //       province: 'Ontario',
  //       country: 'Canada',
  //       kind: 'work'
  //     }
  //   }
}

async function main() {
  const modelManager = createPackageTrackingModel();

  // Get the Shipment that the user is configuring
  const packages = modelManager.getModel<PackageTracking>(
    'example:packages.shipping'
  )!;
  const shipment = getNewShipment(packages);

  await addShipment(modelManager, shipment);
}

main();
