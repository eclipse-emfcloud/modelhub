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
  createModelUpdaterCommand,
} from '@eclipse-emfcloud/model-manager';
import {
  AbstractModelServiceContribution,
  HubAwareProvider,
  ModelHub,
  ModelPersistenceContribution,
  ModelTriggerContribution,
  ModelTriggerPatch,
  ModelValidationContribution,
} from '@eclipse-emfcloud/model-service';
import { Diagnostic, merge, ok } from '@eclipse-emfcloud/model-validation';
import {
  addOrReplaceOperations,
  nonTestOperations,
} from '@eclipse-emfcloud/trigger-engine';
import { deepClone } from '@theia/core';
import {
  inject,
  injectable,
  postConstruct,
} from '@theia/core/shared/inversify';
import { WorkspaceServer } from '@theia/workspace/lib/common';
import { Operation, getValueByPointer } from 'fast-json-patch';
import { readFile, writeFile } from 'fs/promises';
import { eq as deepEqual } from 'lodash';
import {
  Address,
  AddressBook,
  AddressBookModelID,
  AddressBookMyAddressesProviderResult,
  AddressEntry,
  isAddressBook,
  isAddressBookModelId,
} from '../common';
import { lastSegment, upToLastSegment } from '../common/helpers';
import { AddressBookAPI, SomeAddress } from './model-service-api';
import {
  AddressBookPrivateAPIImpl,
  AddressBookPrivateAPIServer,
} from './model-service-private-api-impl';

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

@injectable()
export class AddressBookModelServiceContribution extends AbstractModelServiceContribution<
  string,
  AddressBook
> {
  @inject(AddressBookPrivateAPIServer)
  private privateAPI: AddressBookPrivateAPIServer;

  @inject(WorkspaceServer) workspaceServer: WorkspaceServer;

  private publicAPI: AddressBookAPI;

  @postConstruct()
  protected init(): void {
    this.initialize({
      id: AddressBookModelID,
      persistenceContribution: this.createPersistenceContribution(
        this.workspaceServer
      ),
      validationContribution: this.createValidationContribution(),
      triggerContribution: this.createTriggerContribution(),
      modelAccessorContribution: {
        getProviders: () => [
          new AddressBookMyAddressProvider(AddressBookModelID),
        ],
      },
    });
  }

  setModelHub(modelHub: ModelHub<string, string>): void {
    super.setModelHub(modelHub);

    this.privateAPI.registerContext(
      modelHub.context,
      new AddressBookPrivateAPIImpl(
        modelHub.context,
        this.modelManager,
        modelHub
      )
    );
  }

  getModelService<S>(): S {
    if (!this.publicAPI) {
      const checkModelId = (modelId: string): string => {
        if (!isAddressBookModelId(modelId)) {
          throw new Error(
            `Model ID '${modelId}' is not an address book model.`
          );
        }
        return modelId;
      };
      const getModelChecked = (modelId: string): AddressBook => {
        const model = this.modelManager.getModel(checkModelId(modelId));
        // Sanity check
        if (!isAddressBook(model)) {
          throw new Error(
            `Model '${modelId}' does not exist or is not an address book.`
          );
        }
        return model;
      };

      this.publicAPI = {
        getAddEntryCommand(
          modelId: string,
          lastName: string,
          firstName: string,
          address: SomeAddress
        ): Command<string> | undefined {
          const model = getModelChecked(modelId);
          if (
            model.entries.some((entry) => {
              return (
                entry.lastName === lastName &&
                entry.firstName === firstName &&
                entry.addresses.some((addr) => deepEqual(addr, address))
              );
            })
          ) {
            return undefined; // Already present
          }
          return createModelUpdaterCommand(
            'Add Address Entry',
            modelId,
            (model: AddressBook) =>
              model.entries.push({
                lastName,
                firstName,
                addresses: [address],
              })
          );
        },
        getAddAddressCommand(
          modelId: string,
          lastName: string,
          firstName: string,
          address: SomeAddress
        ): Command<string> | undefined {
          const model = getModelChecked(modelId);
          const entryIndex = model.entries.findIndex(
            (entry) =>
              entry.lastName === lastName && entry.firstName === firstName
          );
          if (entryIndex < 0) {
            throw new Error(
              `Model '${modelId}' has no entry '${lastName}, ${firstName}'`
            );
          }
          const entry = model.entries[entryIndex];
          if (entry.addresses.some((addr) => deepEqual(addr, address))) {
            return undefined; // Already present
          }
          return createModelUpdaterCommand(
            'Add Address',
            modelId,
            (model: AddressBook) =>
              model.entries[entryIndex].addresses.push(address)
          );
        },
      };
    }
    return this.publicAPI as S;
  }

  private createPersistenceContribution(
    workspaceServer: WorkspaceServer
  ): ModelPersistenceContribution<string, AddressBook> {
    return {
      async canHandle(modelId: string): Promise<boolean> {
        // We use Theia workspace service to access files by workspace-relative path
        const root = await workspaceServer.getMostRecentlyUsedWorkspace();
        if (!root) {
          return false;
        }
        const url = new URL(modelId, root);
        return (
          url.protocol === 'example' && url.pathname.endsWith('.addressbook')
        );
      },
      async loadModel(modelId: string): Promise<AddressBook> {
        const root = await workspaceServer.getMostRecentlyUsedWorkspace();
        const modelPath = new URL(modelId).pathname;
        const content = await readFile(new URL(modelPath, root), {
          encoding: 'utf-8',
        });
        const result = JSON.parse(content);
        // Sanity check
        if (isAddressBook(result)) {
          throw new Error(
            `Content of model '${modelId}' is not an address book.`
          );
        }
        return result;
      },
      async saveModel(modelId: string, model: AddressBook): Promise<boolean> {
        const root = await workspaceServer.getMostRecentlyUsedWorkspace();
        const content = JSON.stringify(model);
        const modelPath = new URL(modelId).pathname;
        await writeFile(new URL(modelPath, root), content, {
          encoding: 'utf-8',
        });
        return true;
      },
    };
  }

  private createValidationContribution(): ModelValidationContribution<
    string,
    AddressBook
  > {
    const source = AddressBookModelID;
    return {
      getValidators: () => [
        {
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
                  const actualRegionKey = regionKeys.find(
                    (key) => !!address[key]
                  );
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
        },
      ],
    };
  }

  private createTriggerContribution(): ModelTriggerContribution<
    string,
    AddressBook
  > {
    return {
      getTriggers: () => [
        {
          getPatch(
            modelId: NonNullable<string>,
            model: NonNullable<unknown>,
            delta: Operation[]
          ): ModelTriggerPatch {
            if (!isAddressBookModelId(modelId)) {
              return undefined;
            }
            const patch: Operation[] = [];
            addOrReplaceOperations(delta)
              .filter((op) => lastSegment(op.path) === 'country')
              .forEach((countrySetting) => {
                const expectedRegionKey =
                  expectedRegionKeys[countrySetting.value as string] ??
                  'otherAdministrativeSubdivision';
                const addressPath = upToLastSegment(countrySetting.path);
                const address = getValueByPointer(
                  model,
                  addressPath
                ) as Address;
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
          },
        },
        {
          getPatch(
            modelId: NonNullable<string>,
            model: NonNullable<unknown>,
            delta: Operation[]
          ): ModelTriggerPatch {
            if (!isAddressBookModelId(modelId)) {
              return undefined;
            }
            const patch: Operation[] = [];
            addOrReplaceOperations(delta)
              .filter((op) =>
                regionKeys.includes(
                  lastSegment(op.path) as (typeof regionKeys)[number]
                )
              )
              .forEach((regionSetting) => {
                const addressPath = upToLastSegment(regionSetting.path);
                const address = getValueByPointer(
                  model,
                  addressPath
                ) as Address;
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
                const address = getValueByPointer(
                  model,
                  addressPath
                ) as Address;
                const expectedRegionKey =
                  expectedRegionKeys[address.country] ??
                  'otherAdministrativeSubdivision';

                regionKeys
                  .filter(
                    (key) =>
                      key !== expectedRegionKey && address[key] !== undefined
                  )
                  .forEach((key) => {
                    patch.push({
                      op: 'remove',
                      path: `${addressPath}/${key}`,
                    });
                  });
              });

            return patch;
          },
        },
      ],
    };
  }
}

/**
 * This provider detect changes on the "isSelf" boolean
 */
class AddressBookMyAddressProvider extends HubAwareProvider {
  modelId: string;
  modelHub: ModelHub<string, object>;
  refAddressBook: AddressBook;
  constructor(modelId: string) {
    super('addressbook');
    this.modelId = modelId;
    this.get = this.get.bind(this);
    this.accessors.set('my-main-address-changed', this.getMyAddresses);
  }

  setModelHub(modelHub: ModelHub<string, object>): void {
    super.setModelHub(modelHub);
    const subscription = modelHub.subscribe(this.modelId);

    // Store an address book to detect the changes
    this.modelHub
      .getModel<AddressBook>(this.modelId)
      .then((model) => (this.refAddressBook = model));

    subscription.onModelChanged = (
      _modelId: string,
      model: object,
      delta?: Operation[]
    ) => {
      // Make sure the model is an Address Book
      if (!isAddressBook(model)) {
        return;
      }

      // React to changes applied to isSelf
      if (
        delta &&
        nonTestOperations(delta).some((op) => lastSegment(op.path) === 'isSelf')
      ) {
        let isSelfHasChanged = false;

        const operations = nonTestOperations(delta).filter(
          (op) => lastSegment(op.path) === 'isSelf'
        );

        for (const operation of operations) {
          // Search for the address and the parent entry.
          const addressPath = upToLastSegment(operation.path);
          const address = getValueByPointer(model, addressPath) as Address;

          // Look for the parent entry
          const entryPath = upToLastSegment(addressPath);
          const entry = getValueByPointer(model, entryPath) as AddressEntry;

          // Look for known entry from our reference Address Book
          const knownEntry = this.refAddressBook.entries.find(
            (e) =>
              e.firstName === entry.firstName && e.lastName === entry.lastName
          );

          // if this is a new entry, trigger is bound to the isSelf value
          if (!knownEntry) {
            isSelfHasChanged = address.isSelf ?? false;
            break;
          }

          // otherwise, look for index changes.
          // First, look for the previous isSelf === true index
          const firstIsSelfIndex = knownEntry.addresses.findIndex(
            (knownAddress) => knownAddress.isSelf
          );

          // Second, look for the new isSelf === true index
          const newIsSelfIndex = entry.addresses.findIndex(
            (address) => address.isSelf
          );

          // if the previous isSelf index is different from the new one
          // set the boolean to trigger the change and exit the loop
          if (firstIsSelfIndex !== newIsSelfIndex) {
            isSelfHasChanged = true;
            break;
          }
        }

        if (isSelfHasChanged) {
          this.notify('my-main-address-changed');
        }

        // Update the stored address book
        this.refAddressBook = deepClone(model);
      }
    };
  }

  private async getMyAddresses(
    firstName: string,
    lastName: string
  ): Promise<AddressBookMyAddressesProviderResult> {
    const addressBook = await this.modelHub.getModel<AddressBook>(this.modelId);
    const result: AddressBookMyAddressesProviderResult = {
      getMainAddress: () => result.myAddresses[0],
      myAddresses: [],
    };

    // Search for my-addresses
    addressBook.entries
      .filter(
        (entry) => entry.firstName === firstName && entry.lastName === lastName
      )
      .forEach((entry) =>
        result.myAddresses.push(
          ...entry.addresses.filter((address) => address.isSelf)
        )
      );

    return result;
  }
}
