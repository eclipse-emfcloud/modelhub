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
  createModelUpdaterCommand,
} from '@eclipse-emfcloud/model-manager';
import {
  Diagnostic,
  ModelValidationService,
  ModelValidationServiceImpl,
  Validator,
  merge,
  ok,
} from '@eclipse-emfcloud/model-validation';
import {
  Address,
  AddressBook,
  isAddressBook,
  isAddressBookModelId,
} from './address-book';

import { afterAsyncs, inspect } from './helpers';

const source = '@example/address-book';

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
            state: 'Ontario',
            country: 'Canada',
          },
        ],
      },
    ],
  };

  modelManager.setModel('example:contacts.addressbook', contacts);

  return modelManager;
}

function createAddressValidator() {
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

  const addressValidator: Validator<string, AddressBook> = {
    async validate(modelId: string, model: unknown) {
      if (!isAddressBookModelId(modelId)) {
        return ok(source);
      }
      // Sanity check
      if (!isAddressBook(model)) {
        return {
          severity: 'error',
          message: `Model '${modelId}' is not an address book.`,
          source,
          path: '',
        };
      }
      const diagnosis: Diagnostic[] = [];
      for (let i = 0; i < model.entries.length; i++) {
        const entry = model.entries[i];
        for (let j = 0; j < entry.addresses.length; j++) {
          const address = entry.addresses[j];
          const regionsSet =
            (address.province ? 1 : 0) +
            (address.state ? 1 : 0) +
            (address.otherAdministrativeSubdivision ? 1 : 0);
          if (regionsSet > 1) {
            diagnosis.push({
              severity: 'error',
              message: `${regionsSet} of 'province', 'state', and 'otherAdministrativeSubdivision' are set where only at most 1 may be.`,
              source,
              path: `/entries/${i}/addresses/${j}`,
            });
          } else if (regionsSet === 0) {
            const missingRegionKey =
              expectedRegionKeys[address.country] ??
              'otherAdministrativeSubdivision';
            diagnosis.push({
              severity: 'error',
              message: `Address is missing a value of '${missingRegionKey}' in ${address.country}.`,
              source,
              path: `/entries/${i}/addresses/${j}/${missingRegionKey}`,
            });
          } else {
            const actualRegionKey = regionKeys.find((key) => !!address[key]);
            const goodRegionKey =
              expectedRegionKeys[address.country] ??
              'otherAdministrativeSubdivision';
            if (actualRegionKey !== goodRegionKey) {
              diagnosis.push({
                severity: 'warn',
                message: `Address should use '${goodRegionKey}' in ${address.country} instead of '${actualRegionKey}'.`,
                source,
                path: `/entries/${i}/addresses/${j}/${actualRegionKey}`,
              });
            }
          }
        }
      }
      return merge(...diagnosis);
    },
  };

  return addressValidator;
}

function createModelValidationService(...validators: Validator<string>[]) {
  const validationService: ModelValidationService<string> =
    new ModelValidationServiceImpl();

  validators.forEach((validator) => validationService.addValidator(validator));

  return validationService;
}

async function validateAddressBook(
  modelManager: ModelManager<string>,
  validationService: ModelValidationService<string>
) {
  const contacts = modelManager.getModel<AddressBook>(
    'example:contacts.addressbook'
  )!;
  const diagnostic = await validationService.validate(
    'example:contacts.addressbook',
    contacts
  );

  console.log('Diagnosis:', inspect(diagnostic));

  // Diagnosis: {
  //   severity: 'warn',
  //   message: "Address should use 'province' in Canada instead of 'state'.",
  //   source: '@example/address-book',
  //   path: '/entries/0/addresses/0/state'
  // }
}

async function subscribeToValidation(
  modelManager: ModelManager<string>,
  validationService: ModelValidationService<string>
) {
  const fix = createModelUpdaterCommand(
    'Fix Region Key Problem',
    'example:contacts.addressbook',
    (model: AddressBook) => {
      model.entries[0].addresses[0].province =
        model.entries[0].addresses[0].state;
      delete model.entries[0].addresses[0].state;
    }
  );

  const validationSub = validationService.subscribe(
    'example:contacts.addressbook'
  );
  validationSub.onValidationChanged = (modelId, _model, diagnostic) => {
    console.log(`Diagnosis of model '${modelId}':`, inspect(diagnostic));
  };
  const modelSub = modelManager.subscribe();
  modelSub.onModelChanged = (modelId, model) =>
    validationService.validate(modelId, model);
  await modelManager.getCommandStack('main').execute(fix);

  // Diagnosis of model 'example:contacts.addressbook': {
  //   severity: 'ok',
  //   message: 'OK.',
  //   source: '@eclipse-emfcloud/model-validation',
  //   path: ''
  // }

  afterAsyncs(() => {
    modelSub.close();
    validationSub.close();
  });
}

async function main() {
  const modelManager = createAddressBookModel();
  const validator = createAddressValidator();
  const validationService = createModelValidationService(validator);

  await validateAddressBook(modelManager, validationService);
  await subscribeToValidation(modelManager, validationService);
}

main();
