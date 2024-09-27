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
  ModelAccessorBus,
  ProviderChangeSubscription,
} from '@eclipse-emfcloud/model-accessor-bus';
import { RpcServer } from '@theia/core';
import { inject, injectable } from '@theia/core/shared/inversify';
import {
  ModelAccessorBusClient,
  ModelAccessorBusProtocol,
  ProviderChangeSubscriptionToken,
} from '../common';
import { ModelHubProvider } from './model-hub-provider';

@injectable()
export class ModelAccessorBusServer<K = string>
  implements ModelAccessorBusProtocol, RpcServer<ModelAccessorBusClient>
{
  @inject(ModelHubProvider)
  protected readonly modelHub: ModelHubProvider<K>;

  private nextSubscriptionId = 0;

  protected client: ModelAccessorBusClient | undefined;

  protected async getModelAccessorBus(
    context: string
  ): Promise<ModelAccessorBus> {
    const hub = await this.modelHub(context);
    return hub.getModelAccessorBus();
  }

  protected readonly subscriptionTokens = new Map<
    number,
    ProviderChangeSubscriptionEntry
  >();

  setClient(client: ModelAccessorBusClient | undefined): void {
    if (this.client !== client) {
      // All subscriptions are invalidated
      this.disposeSubscriptions();
    }

    this.client = client;
  }

  getClient(): ModelAccessorBusClient | undefined {
    return this.client;
  }

  async subscribe(
    context: string,
    accessorId: string
  ): Promise<ProviderChangeSubscriptionToken> {
    const token = {
      id: ++this.nextSubscriptionId,
      accessorId: accessorId,
    };

    if (this.client) {
      const client = this.client;

      const subscription = (await this.getModelAccessorBus(context)).subscribe(
        accessorId,
        () => {
          client.onAccessorChanged(token.id);
        }
      );

      const doCloseSub = subscription.close.bind(subscription);
      subscription.close = () => {
        client.closeSubscription(token.id);
        doCloseSub();
      };

      this.subscriptionTokens.set(token.id, { token, subscription });
    }

    return token;
  }

  closeSubscription(token: ProviderChangeSubscriptionToken): void {
    const subscription = this.subscriptionTokens.get(token.id)?.subscription;
    this.subscriptionTokens.delete(token.id);
    subscription?.close();
  }

  protected disposeSubscriptions(): void {
    for (const next of this.subscriptionTokens.values()) {
      // The subscription is bound to a particular client and
      // closes itself in that client
      next.subscription.close();
    }
    this.subscriptionTokens.clear();
  }

  async get<T>(
    context: string,
    accessorId: string,
    ...parameters: unknown[]
  ): Promise<T | undefined> {
    return (await this.getModelAccessorBus(context)).get<T>(
      accessorId,
      ...parameters
    );
  }

  dispose(): void {
    this.disposeSubscriptions();
  }
}

interface ProviderChangeSubscriptionEntry {
  token: ProviderChangeSubscriptionToken;
  subscription: ProviderChangeSubscription;
}
