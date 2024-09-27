// *****************************************************************************
// Copyright (C) 2024 STMicroelectronics.
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
import { ModelA } from '@eclipse-emfcloud-example/model-a-api';
import { Accessor } from '@eclipse-emfcloud/model-accessor-bus';
import {
  HubAwareProvider,
  ModelAccessorContribution,
  ModelHub,
} from '@eclipse-emfcloud/model-service';
import { Deferred } from '@theia/core/lib/common/promise-util';
import { Operation } from 'fast-json-patch';

export function createModelAccessorContribution(
  modelURIProvider: () => Promise<string>
): ModelAccessorContribution {
  const modelURI = modelURIProvider();
  const modelAccessorProviders = [
    new ParityProvider(modelURI),
    new FirstNameProvider(modelURI),
  ];

  return {
    getProviders() {
      return modelAccessorProviders;
    },
  };
}

abstract class AsyncHubAwareProvider extends HubAwareProvider {
  protected readonly ready: Promise<void>;
  protected modelURI: string;
  private futureModelHub = new Deferred<ModelHub<string, object>>();

  constructor(id: string, modelURI: Promise<string>) {
    super(id);
    const modelIdReady = modelURI.then((uri) => (this.modelURI = uri));
    this.ready = Promise.all([
      modelIdReady,
      this.futureModelHub.promise,
    ]).then();
    this.ready.then(() => this.initialize());
  }

  override setModelHub(modelHub: ModelHub<string, object>): void {
    super.setModelHub(modelHub);
    this.futureModelHub.resolve(modelHub);
  }

  protected whenReady(accessor: Accessor): Accessor {
    return async (...args: unknown[]) => {
      await this.ready;
      return accessor(...args);
    };
  }

  protected abstract initialize(): void;
}

class ParityProvider extends AsyncHubAwareProvider {
  constructor(modelURI: Promise<string>) {
    super('parity', modelURI);
    this.isSumEven = this.isSumEven.bind(this);
    this.accessors.set('sum', this.whenReady(this.isSumEven));
  }

  protected initialize(): void {
    const subscription = this.modelHub.subscribe(this.modelURI.toString());
    subscription.onModelChanged = (
      _modelId: string,
      _model: object,
      delta?: Operation[]
    ) => {
      if (delta?.some((op) => op.path === '/sum')) {
        this.notify('sum');
      }
    };
  }

  private async isSumEven(): Promise<boolean> {
    const model = await this.modelHub.getModel<ModelA>(
      this.modelURI.toString()
    );
    return model.sum % 2 === 0;
  }
}

class FirstNameProvider extends AsyncHubAwareProvider {
  constructor(modelURI: Promise<string>) {
    super('firstName', modelURI);
    this.getFirstName = this.getFirstName.bind(this);
    this.accessors.set('get', this.whenReady(this.getFirstName));
  }

  protected initialize(): void {
    const subscription = this.modelHub.subscribe(this.modelURI.toString());
    subscription.onModelChanged = (
      _modelId: string,
      _model: object,
      delta?: Operation[]
    ) => {
      if (delta?.some((op) => op.path === '/firstName')) {
        this.notify('get');
      }
    };
  }

  private async getFirstName(): Promise<string> {
    const model = await this.modelHub.getModel<ModelA>(
      this.modelURI.toString()
    );
    return model.firstName;
  }
}
