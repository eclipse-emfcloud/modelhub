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
import { Diagnostic } from '@eclipse-emfcloud/model-validation';
import { Disposable, DisposableCollection } from '@theia/core';
import {
  inject,
  injectable,
  postConstruct,
} from '@theia/core/shared/inversify';
import { isAddressBookModelId } from '../common';

const modelHubContextId = 'address-books';

@injectable()
export class AddressBookDiagnostician implements Disposable {
  @inject(ModelHubProvider)
  private readonly modelHubProvider: ModelHubProvider<string>;

  private toDispose = new DisposableCollection();

  @postConstruct()
  initialize(): void {
    this.modelHubProvider(modelHubContextId).then(
      async (modelHub: ModelHub<string>) => {
        // Just make sure
        modelHub.liveValidation = true;

        const subscription = await modelHub.subscribe();
        this.toDispose.push(Disposable.create(() => subscription.close()));

        subscription.onModelValidated = (
          modelId: string,
          _model: unknown,
          diagnostic: Diagnostic
        ) => {
          if (!isAddressBookModelId(modelId)) {
            return;
          }
          const okStatus =
            diagnostic.severity === 'ok' ? 'is OK' : 'has problems';
          console.log(
            `An address book with ID '${modelId}' was validated and it ${okStatus}.`
          );
        };
      }
    );
  }

  async validateNow(modelId: string): Promise<Diagnostic> {
    if (!isAddressBookModelId(modelId)) {
      return this.notAddressBookDiagnostic(modelId);
    }
    const modelHub = await this.modelHubProvider(modelHubContextId);
    return modelHub.validateModels(modelId);
  }

  async getCurrentDiagnostic(modelId: string): Promise<Diagnostic> {
    if (!isAddressBookModelId(modelId)) {
      return this.notAddressBookDiagnostic(modelId);
    }
    const modelHub = await this.modelHubProvider(modelHubContextId);
    const current = modelHub.getValidationState(modelId);
    return current ?? modelHub.validateModels(modelId);
  }

  private notAddressBookDiagnostic(modelId: string): Diagnostic {
    return {
      severity: 'warn',
      message: `Model is not an address book: ${modelId}`,
      source: '@example/address-book',
      path: '',
    };
  }

  dispose(): void {
    this.toDispose.dispose();
  }
}
