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
  createModelManager,
  createModelPatchCommand,
  createModelUpdaterCommand,
} from '@eclipse-emfcloud/model-manager';
import {
  Trigger,
  TriggerEngine,
  TriggerEngineImpl,
  TriggerPatch,
  addOrReplaceOperations,
} from '@eclipse-emfcloud/trigger-engine';
import { Operation, getValueByPointer } from 'fast-json-patch';
import {
  Address,
  AddressBook,
  AddressEntry,
  isAddressBook,
} from './address-book';

import { cloneDeep } from 'lodash';
import { afterAsyncs, inspect, lastSegment, upToLastSegment } from './helpers';

const regionKeys = [
  'province',
  'state',
  'otherAdministrativeSubdivision',
] as const;
const expectedRegionKeys: { [country: string]: keyof Address } = {
  Canada: 'province',
  'United States of America': 'state',
  Australia: 'state',
};

process.on('unhandledRejection', () => undefined);
process.on('rejectionHandled', () => undefined);

function createAddressBookModel() {
  const modelManager: ModelManager<string> = createModelManager();
  const contacts: AddressBook = {
    entries: [
      {
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
      },
    ],
  };

  modelManager.setModel('example:contacts.addressbook', contacts);

  return modelManager;
}

function createEmptyAddressBookModel() {
  const modelManager: ModelManager<string> = createModelManager();
  const contacts: AddressBook = {
    entries: [],
  };

  modelManager.setModel('example:contacts.addressbook', contacts);

  return modelManager;
}

function createSetAdministrativeRegionPropertyTrigger() {
  const setAdministrativeRegionPropertyTrigger: Trigger<AddressBook> = (
    model: NonNullable<unknown>,
    delta: Operation[]
  ): TriggerPatch => {
    if (!isAddressBook(model)) {
      return undefined;
    }
    const patch: Operation[] = [];
    addOrReplaceOperations(delta)
      .filter((op) => lastSegment(op.path) === 'country')
      .forEach((countrySetting) => {
        const addressPath = upToLastSegment(countrySetting.path);
        const address = getValueByPointer(model, addressPath) as Address;
        const expectedRegionKey =
          expectedRegionKeys[countrySetting.value as string] ??
          'otherAdministrativeSubdivision';
        const setKey = regionKeys
          .filter((key) => key !== expectedRegionKey)
          .find((key) => address[key] !== undefined);
        if (setKey) {
          // Just set the required administrative region property. The next trigger will clean up any others
          patch.push({
            op: expectedRegionKey in address ? 'replace' : 'add',
            path: `${addressPath}/${expectedRegionKey}`,
            value: address[setKey],
          });
        }
      });

    return patch;
  };

  return setAdministrativeRegionPropertyTrigger;
}

function createRemoveOtherRegionPropertiesTrigger() {
  const removeOtherRegionPropertiesTrigger: Trigger<AddressBook> = (
    model: NonNullable<unknown>,
    delta: Operation[]
  ): TriggerPatch => {
    if (!isAddressBook(model)) {
      return undefined;
    }
    const patch: Operation[] = [];
    addOrReplaceOperations(delta)
      .filter((op) =>
        regionKeys.includes(lastSegment(op.path) as (typeof regionKeys)[number])
      )
      .forEach((regionSetting) => {
        const addressPath = upToLastSegment(regionSetting.path);
        const address = getValueByPointer(model, addressPath) as Address;
        const regionKeyThatWasSet = lastSegment(regionSetting.path);
        const expectedRegionKey =
          expectedRegionKeys[address.country] ??
          'otherAdministrativeSubdivision';

        if (regionKeyThatWasSet != expectedRegionKey) {
          patch.push({
            op: 'remove',
            path: `${addressPath}/${regionKeyThatWasSet}`,
          });
        }
      });

    addOrReplaceOperations(delta)
      .filter((op) => lastSegment(op.path) === 'country')
      .forEach((countrySetting) => {
        const addressPath = upToLastSegment(countrySetting.path);
        const address = getValueByPointer(model, addressPath) as Address;
        const expectedRegionKey =
          expectedRegionKeys[address.country] ??
          'otherAdministrativeSubdivision';

        regionKeys
          .filter(
            (key) => key !== expectedRegionKey && address[key] !== undefined
          )
          .forEach((key) => {
            patch.push({
              op: 'remove',
              path: `${addressPath}/${key}`,
            });
          });
      });

    return patch;
  };

  return removeOtherRegionPropertiesTrigger;
}

function createDefaultAddressTrigger() {
  const defaultAddressTrigger: Trigger<AddressBook> = (
    model: NonNullable<unknown>,
    delta: Operation[]
  ): TriggerPatch => {
    if (!isAddressBook(model)) {
      return undefined;
    }
    const patch: Operation[] = [];
    addOrReplaceOperations(delta)
      .filter((op) => op.path.match(/^\/entries\/\d+$/))
      .forEach((entrySetting) => {
        const addedEntry = getValueByPointer(
          model,
          entrySetting.path
        ) as AddressEntry;
        if (addedEntry.addresses.length === 0) {
          patch.push({
            op: 'add',
            path: `${entrySetting.path}/addresses/-`,
            value: {
              kind: 'home',
              numberAndStreet: '123 Front Street',
              city: 'Exampleville',
              province: 'Ontario',
              country: 'Canada',
            },
          });
        }
      });

    return patch;
  };

  return defaultAddressTrigger;
}

function setUpTriggers(...triggers: Trigger<AddressBook>[]) {
  const triggerEngine: TriggerEngine = new TriggerEngineImpl();

  triggers.forEach((trigger) => triggerEngine.addTrigger(trigger));

  return triggerEngine;
}

function createModelSubscriptionForTriggers(
  modelManager: ModelManager<string>,
  triggerEngine: TriggerEngine
) {
  const triggerSub = modelManager.subscribe('example:contacts.addressbook');
  let previousState = cloneDeep(
    modelManager.getModel('example:contacts.addressbook')!
  );
  triggerSub.onModelChanged = async (modelId, model, delta) => {
    if (!delta || delta.length === 0) {
      return;
    }

    const triggerCommand = createModelPatchCommand(
      'Apply Triggers',
      modelId,
      () => {
        const newPreviousState = cloneDeep(model);
        const result = triggerEngine
          .applyTriggers(model, delta, previousState)
          .then((patch) => patch ?? []);
        previousState = newPreviousState;
        return result;
      }
    );
    const stack = modelManager.getCommandStack('triggers');
    if (!(await stack.canExecute(triggerCommand))) {
      console.error('Cannot run triggers for model integrity!');
    } else {
      stack.execute(triggerCommand);
    }
  };

  return triggerSub;
}

function getSetStateCommand(state: string) {
  return createModelUpdaterCommand(
    'Set State',
    'example:contacts.addressbook',
    (model: AddressBook) => (model.entries[0].addresses[0].state = state)
  );
}

function getSetCountryCommand(country: string) {
  return createModelUpdaterCommand(
    'Set Country',
    'example:contacts.addressbook',
    (model: AddressBook) => (model.entries[0].addresses[0].country = country)
  );
}

async function triggersExample() {
  const modelManager = createAddressBookModel();
  const triggerEngine = setUpTriggers(
    createSetAdministrativeRegionPropertyTrigger(),
    createRemoveOtherRegionPropertiesTrigger()
  );
  const subscription = createModelSubscriptionForTriggers(
    modelManager,
    triggerEngine
  );

  let contacts = modelManager.getModel<AddressBook>(
    'example:contacts.addressbook'
  )!;
  console.log('Initial address book:', inspect(contacts));

  // Initial address book: {
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

  const stack = modelManager.getCommandStack('main');
  await stack.execute(getSetStateCommand('Minnesota'));

  await afterAsyncs(() => {
    contacts = modelManager.getModel<AddressBook>(
      'example:contacts.addressbook'
    )!;
    console.log('After setting state:', inspect(contacts));
  });

  // After setting state: {
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

  await stack.execute(getSetCountryCommand('Australia'));

  await afterAsyncs(() => {
    contacts = modelManager.getModel<AddressBook>(
      'example:contacts.addressbook'
    )!;
    console.log('After setting country:', inspect(contacts));
  });

  // After setting country: {
  //   entries: [
  //     {
  //       lastName: 'Brown',
  //       firstName: 'Alice',
  //       addresses: [
  //         {
  //           kind: 'home',
  //           numberAndStreet: '123 Front Street',
  //           city: 'Exampleville',
  //           country: 'Australia',
  //           state: 'Ontario'
  //         }
  //       ]
  //     }
  //   ]
  // }

  await afterAsyncs(() => subscription.close());
}

async function testHandlingUndoExampleBroken() {
  const modelManager = createEmptyAddressBookModel();
  const triggerEngine = setUpTriggers(createDefaultAddressTrigger());
  const subscription = createModelSubscriptionForTriggers(
    modelManager,
    triggerEngine
  );

  let contacts = modelManager.getModel<AddressBook>(
    'example:contacts.addressbook'
  )!;
  console.log('Initial address book:', inspect(contacts));

  // Initial address book: { entries: [] }

  const stack = modelManager.getCommandStack('main');
  const addEntryCommand = createModelUpdaterCommand(
    'Add Entry',
    'example:contacts.addressbook',
    (model: AddressBook) =>
      model.entries.push({
        lastName: 'Brown',
        firstName: 'Alice',
        addresses: [],
      })
  );
  await stack.execute(addEntryCommand);

  await afterAsyncs(() => {
    contacts = modelManager.getModel<AddressBook>(
      'example:contacts.addressbook'
    )!;
    console.log('After adding entry:', inspect(contacts));
  });

  // After adding entry: {
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

  await stack
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

  contacts = modelManager.getModel<AddressBook>(
    'example:contacts.addressbook'
  )!;
  console.log('After undo fails:', inspect(contacts));

  // After undo fails: {
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

  await afterAsyncs(() => subscription.close());
}

async function testHandlingUndoExampleFixed() {
  const modelManager = createEmptyAddressBookModel();
  const triggerEngine = setUpTriggers(createDefaultAddressTrigger());
  const subscription = createModelSubscriptionForTriggers(
    modelManager,
    triggerEngine
  );

  let contacts = modelManager.getModel<AddressBook>(
    'example:contacts.addressbook'
  )!;
  console.log('Initial address book:', inspect(contacts));

  // Initial address book: { entries: [] }

  const stack = modelManager.getCommandStack('main');
  const addEntryCommand = createModelUpdaterCommand(
    'Add Entry',
    'example:contacts.addressbook',
    (model: AddressBook) =>
      model.entries.push({
        lastName: 'Brown',
        firstName: 'Alice',
        addresses: [],
      }),
    { preconditionsMode: 'lax' }
  );
  await stack.execute(addEntryCommand);

  await afterAsyncs(() => {
    contacts = modelManager.getModel<AddressBook>(
      'example:contacts.addressbook'
    )!;
    console.log('After adding entry:', inspect(contacts));
  });

  // After adding entry: {
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

  await stack.undo();

  // }
  // Inapplicable undo/redo patch. Re-trying without tests. TEST_OPERATION_FAILED: Test operation failed
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
  //   index: 0,
  //   operation: {
  //     op: 'test',
  //     path: '/entries/0',
  //     value: { lastName: 'Brown', firstName: 'Alice', addresses: [] }
  //   },
  //   tree: { entries: [ [Object] ] }
  // }

  contacts = modelManager.getModel<AddressBook>(
    'example:contacts.addressbook'
  )!;
  console.log('After undo:', inspect(contacts));

  // After undo: {
  //   entries: []
  // }

  await afterAsyncs(() => subscription.close());
}

async function main() {
  await triggersExample();
  await testHandlingUndoExampleBroken();
  await testHandlingUndoExampleFixed();
}

main();
