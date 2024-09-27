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

import { Diagnostic } from '@eclipse-emfcloud/model-validation';
import {
  Container,
  injectable,
  interfaces,
} from '@theia/core/shared/inversify';
import { Operation } from 'fast-json-patch';
import {
  ModelHubClient,
  ModelHubProtocol,
  ModelServiceSubscriptionToken,
} from '../../common';
import {
  FrontendModelHubSubscriber,
  FrontendModelHubSubscriberImpl,
} from '../frontend-model-hub-subscriber';

/**
 * All that we need for testing are the subscription-related methods and `getModel()`.
 */
@injectable()
export class FakeModelHubProtocol<K = string>
  implements Partial<ModelHubProtocol<K>>
{
  protected nextSubId = 0;
  protected readonly subscriptions = new Map<
    number,
    ModelServiceSubscriptionToken<K>
  >();

  protected readonly models = new Map<K, object>();

  protected client: ModelHubClient<K> | undefined;

  protected readonly pendingSubs = <
    Promise<ModelServiceSubscriptionToken<K>>[]
  >[];

  //
  // Partial implementation of the `ModelHubProtocol` interface.
  //

  subscribe(
    context: string,
    ...modelIds: K[]
  ): Promise<ModelServiceSubscriptionToken<K>> {
    const token = {
      id: ++this.nextSubId,
      modelIds,
    };
    this.subscriptions.set(token.id, token);

    const result =
      context === 'Boom!'
        ? Promise.reject('Bomb context')
        : Promise.resolve(token);
    this.pendingSubs.push(result);
    return result;
  }

  closeSubscription(
    tokenOrId: ModelServiceSubscriptionToken<K> | number
  ): Promise<void> {
    const id = typeof tokenOrId === 'number' ? tokenOrId : tokenOrId.id;
    this.subscriptions.delete(id);
    this.client?.closeSubscription(id);

    return Promise.resolve();
  }

  //
  // Test drivers.
  //

  setModel(modelId: K, model: object): void {
    this.models.set(modelId, model);
    this.pendingSubsReady.then(() =>
      this.lookupSubs(modelId).forEach((sub) =>
        this.client?.onModelLoaded(sub.id, modelId)
      )
    );
  }

  removeModel(modelId: K): void {
    const model = this.models.get(modelId);
    if (model) {
      this.pendingSubsReady
        .then(() =>
          this.lookupSubs(modelId).forEach((sub) =>
            this.client?.onModelUnloaded(sub.id, modelId)
          )
        )
        .finally(() => this.models.delete(modelId));
    }
  }

  getModel<M extends object, C = unknown>(_context: C, modelId: K): Promise<M> {
    return this.models.has(modelId)
      ? Promise.resolve(this.models.get(modelId) as M)
      : Promise.reject(new Error('No such model: ' + modelId));
  }

  fakeModelChange(modelId: K, patch: Operation[]): void {
    this.pendingSubsReady.then(() =>
      this.lookupSubs(modelId).forEach((sub) =>
        this.client?.onModelChanged(sub.id, modelId, patch)
      )
    );
  }

  fakeModelDirtyState(modelId: K, dirty: boolean): void {
    this.pendingSubsReady.then(() =>
      this.lookupSubs(modelId).forEach((sub) =>
        this.client?.onModelDirtyState(sub.id, modelId, dirty)
      )
    );
  }

  fakeModelValidated(modelId: K, diagnostic: Diagnostic): void {
    this.pendingSubsReady.then(() =>
      this.lookupSubs(modelId).forEach((sub) =>
        this.client?.onModelValidated(sub.id, modelId, diagnostic)
      )
    );
  }

  fakeModelLoaded(modelId: K): void {
    this.pendingSubsReady.then(() =>
      this.lookupSubs(modelId).forEach((sub) =>
        this.client?.onModelLoaded(sub.id, modelId)
      )
    );
  }

  fakeModelUnloaded(modelId: K): void {
    this.pendingSubsReady.then(() =>
      this.lookupSubs(modelId).forEach((sub) =>
        this.client?.onModelUnloaded(sub.id, modelId)
      )
    );
  }

  fakeModelHubDisposed(): void {
    this.pendingSubsReady.then(() =>
      this.lookupSubs().forEach((sub) =>
        this.client?.onModelHubDisposed(sub.id)
      )
    );
  }

  fakeModelHubCreated(context: string): void {
    this.client?.onModelHubCreated(context);
  }

  fakeModelHubDestroyed(context: string): void {
    this.client?.onModelHubDestroyed(context);
  }

  fakeSubscriptionClosed(modelId: K): void {
    this.pendingSubsReady.then(() =>
      this.lookupSubs(modelId).forEach((sub) =>
        this.client?.closeSubscription(sub.id)
      )
    );
  }

  setClient(client: ModelHubClient<K>): void {
    this.client = client;
  }

  get pendingSubsReady(): Promise<void> {
    return Promise.allSettled(this.pendingSubs).then(() => {
      this.pendingSubs.length = 0;
    });
  }

  protected lookupSubs(modelId?: K): ModelServiceSubscriptionToken<K>[] {
    const result: ModelServiceSubscriptionToken<K>[] = [];

    if (!this.client) {
      // No point
      return result;
    }

    for (const token of this.subscriptions.values()) {
      if (
        modelId === undefined ||
        token.modelIds?.length === 0 ||
        token.modelIds?.includes(modelId)
      ) {
        result.push(token);
      }
    }

    return result;
  }
}

export function bindFakeModelHubProtocol(
  binder: interfaces.Bind | Container
): void {
  const bind = binder instanceof Container ? binder.bind.bind(binder) : binder;
  bind(FakeModelHubProtocol).toSelf().inSingletonScope();
  bind(ModelHubProtocol).toService(FakeModelHubProtocol);
}

export function connectClient(
  modelHub: FakeModelHubProtocol,
  subscriber: FrontendModelHubSubscriber
): void {
  const subscriberImpl = subscriber as FrontendModelHubSubscriberImpl;
  modelHub.setClient(subscriberImpl.client);
  subscriberImpl.setModelHub(modelHub as unknown as ModelHubProtocol);
}
