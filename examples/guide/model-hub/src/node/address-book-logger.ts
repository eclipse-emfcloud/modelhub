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

import { ModelHub } from '@eclipse-emfcloud/model-service';
import { ModelHubProvider } from '@eclipse-emfcloud/model-service-theia/lib/node';
import { Disposable, DisposableCollection } from '@theia/core';
import {
  inject,
  injectable,
  postConstruct,
} from '@theia/core/shared/inversify';
import { Operation } from 'fast-json-patch';
import { AddressBook, isAddressBookModelId } from '../common';

const modelHubContextId = 'address-books';

@injectable()
export class AddressBookLogger implements Disposable {
  @inject(ModelHubProvider)
  private readonly modelHubProvider: ModelHubProvider<string>;

  private toDispose = new DisposableCollection();

  @postConstruct()
  initialize(): void {
    this.modelHubProvider(modelHubContextId).then(
      async (modelHub: ModelHub<string>) => {
        const subscription = modelHub.subscribe();
        this.toDispose.push(Disposable.create(() => subscription.close()));

        subscription.onModelLoaded = async (modelId: string) => {
          if (!isAddressBookModelId(modelId)) {
            return;
          }
          const addressBook = await modelHub.getModel<AddressBook>(modelId);
          console.log(
            `An address book was loaded with ID '${modelId}':`,
            addressBook
          );
        };

        subscription.onModelUnloaded = async (
          modelId: string,
          addressBook: AddressBook
        ) => {
          if (!isAddressBookModelId(modelId)) {
            return;
          }
          console.log(
            `An address book with ID '${modelId}' was unloaded:`,
            addressBook
          );
        };

        subscription.onModelHubDisposed = () => {
          const isOrIsNot = modelHub.isDisposed ? 'is' : 'is not';
          console.log(
            `Model Hub '${modelHubContextId}' ${isOrIsNot} disposed.`
          );
        };

        subscription.onModelChanged = (
          modelId: string,
          _model: unknown,
          delta?: Operation[]
        ) => {
          if (!isAddressBookModelId(modelId)) {
            return;
          }
          console.log(
            `An address book with ID '${modelId}' was patched with ${
              delta?.length ?? 0
            } changes.`
          );
        };
      }
    );
  }

  dispose(): void {
    this.toDispose.dispose();
  }
}
