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

import { ModelHubSubscription } from '@eclipse-emfcloud/model-service';
import { Diagnostic } from '@eclipse-emfcloud/model-validation';
import { RpcServer } from '@theia/core';
import { inject, injectable } from '@theia/core/shared/inversify';
import { bind, rearg } from 'lodash';
import {
  ModelHubClient,
  ModelHubProtocol,
  ModelServiceSubscriptionToken,
} from '../common';
import {
  ModelHubTracker,
  ModelHubTrackingSubscription,
} from '../common/model-hub-tracker';
import { ModelHubProvider } from './model-hub-provider';

@injectable()
export class ModelHubServer<K = string>
  implements ModelHubProtocol<K>, RpcServer<ModelHubClient<K>>
{
  @inject(ModelHubProvider)
  protected readonly modelHub: ModelHubProvider<K>;

  @inject(ModelHubTracker)
  protected readonly modelHubTracker: ModelHubTracker;
  private clientTrackingSub?: ModelHubTrackingSubscription;

  protected client: ModelHubClient<K> | undefined;

  protected readonly subscriptionTokens = new Map<
    number,
    ModelHubSubscriptionEntry<K>
  >();

  private nextSubscriptionId = 0;

  dispose(): void {
    this.disposeSubscriptions();
  }

  protected disposeSubscriptions(): void {
    for (const next of this.subscriptionTokens.values()) {
      // The subscription is bound to a particular client and
      // closes itself in that client
      next.subscription.close();
    }
    this.subscriptionTokens.clear();

    this.clientTrackingSub?.close();
    this.clientTrackingSub = undefined;
  }

  setClient(client: ModelHubClient<K> | undefined): void {
    if (this.client !== client) {
      // All subscriptions and hub tracking are invalidated
      this.disposeSubscriptions();
      if (client !== undefined) {
        // Create the tracking subscription now so that we will find out
        // about all model hubs already in existence and forward those
        this.clientTrackingSub = this.modelHubTracker.trackModelHubs();
        this.clientTrackingSub.onModelHubCreated = (context) =>
          client.onModelHubCreated(context);
        this.clientTrackingSub.onModelHubDestroyed = (context) =>
          client.onModelHubDestroyed(context);
      }
    }

    this.client = client;
  }

  getClient(): ModelHubClient<K> | undefined {
    return this.client;
  }

  getModel<M extends object = object>(context: string, modelId: K): Promise<M> {
    return this.modelHub(context).then((hub) => hub.getModel(modelId));
  }

  async subscribe(
    context: string,
    ...modelIds: K[]
  ): Promise<ModelServiceSubscriptionToken<K>> {
    const token = {
      id: ++this.nextSubscriptionId,
      modelIds,
    };

    const hub = await this.modelHub(context);
    const subscription: ModelHubSubscription<K> = hub.subscribe(...modelIds);
    if (this.client) {
      const client = this.client;
      const adapt = <K, T, R>(
        callback: (subscriptionId: number, modelId: K, data: T) => R
      ) => {
        return bind(rearg(callback, 0, 1, 3), client, token.id);
      };

      subscription.onModelChanged = adapt(client.onModelChanged);
      subscription.onModelDirtyState = adapt(client.onModelDirtyState);
      subscription.onModelValidated = adapt(client.onModelValidated);
      subscription.onModelLoaded = adapt(client.onModelLoaded);
      subscription.onModelUnloaded = adapt(client.onModelUnloaded);
      subscription.onModelHubDisposed = adapt(client.onModelHubDisposed);
      const doCloseSub = subscription.close.bind(subscription);
      subscription.close = () => {
        client.closeSubscription(token.id);
        doCloseSub();
      };
    }

    this.subscriptionTokens.set(token.id, { token, subscription });
    return token;
  }

  async closeSubscription(
    token: ModelServiceSubscriptionToken<K>
  ): Promise<void> {
    const subscription = this.subscriptionTokens.get(token.id)?.subscription;
    this.subscriptionTokens.delete(token.id);
    subscription?.close();
  }

  validateModels(context: string, ...modelIds: K[]): Promise<Diagnostic> {
    return this.modelHub(context).then((hub) =>
      hub.validateModels(...modelIds)
    );
  }

  getValidationState(
    context: string,
    ...modelIds: K[]
  ): Promise<Diagnostic | undefined> {
    return this.modelHub(context).then((hub) =>
      hub.getValidationState(...modelIds)
    );
  }

  save(context: string, ...commandStackIds: string[]): Promise<boolean> {
    return this.modelHub(context).then((hub) => hub.save(...commandStackIds));
  }

  isDirty(context: string, commandStackId: string): Promise<boolean> {
    return this.modelHub(context).then((hub) => hub.isDirty(commandStackId));
  }

  undo(context: string, commandStackId: string): Promise<boolean> {
    return this.modelHub(context).then((hub) => hub.undo(commandStackId));
  }

  redo(context: string, commandStackId: string): Promise<boolean> {
    return this.modelHub(context).then((hub) => hub.redo(commandStackId));
  }

  flush(context: string, commandStackId: string): Promise<boolean> {
    return this.modelHub(context).then((hub) => hub.flush(commandStackId));
  }
}

interface ModelHubSubscriptionEntry<K = string> {
  token: ModelServiceSubscriptionToken<K>;
  subscription: ModelHubSubscription<K>;
}
