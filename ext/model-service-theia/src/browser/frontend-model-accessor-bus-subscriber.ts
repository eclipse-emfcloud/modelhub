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

import {
  ProviderChangeListener,
  ProviderChangeSubscription,
} from '@eclipse-emfcloud/model-accessor-bus';
import { injectable } from '@theia/core/shared/inversify';
import {
  ModelAccessorBusClient,
  ModelAccessorBusProtocol,
  ProviderChangeSubscriptionToken,
} from '../common';
import type { FrontendModelAccessorBus as _FrontendModelAccessorBus } from './frontend-model-accessor-bus';

export const FrontendModelAccessorBusSubscriber = Symbol(
  'FrontendModelAccessorBusSubscriber'
);

/**
 * An injectable service for creation of subscriptions to receive
 * notifications of changes in model state in the {@link ModelAccessorBusProtocol}.
 * Most clients will not need to use this directly because it is more
 * convenient to use the {@link _FrontendModelAccessorBus | FrontendModelAccessorBus} API, instead.
 */
export interface FrontendModelAccessorBusSubscriber {
  /**
   * Subscribe to model accessor bus notifications.
   *
   * @param context the model hub context in which to subscribe to provider and accessors
   * @param accessorId the accessor ID to which to subscribe, or * to subscribe to all providers/accessors
   */
  subscribe(
    context: string,
    accessorId: string,
    onAccessorChanged: (id: string) => void
  ): Promise<ProviderChangeSubscriptionToken>;

  /**
   * Unsubscribe to a model accessor bus subscription.
   *
   * @param subscriptionId A number identifying a unique subscription to close
   */
  unsubscribe(subscriptionId: number): void;
}

/**
 * A subscription registered on the subscriber is
 * augmented by the providerId/accessorIds that it watches.
 */
type MabProviderSubscription = ProviderChangeSubscription & {
  id: number;
  accessorId: string;
  onAccessorChanged: (id: string) => void;
  close: () => boolean;
};

@injectable()
export class FrontendModelAccessorBusSubscriberImpl
  implements FrontendModelAccessorBusSubscriber
{
  public readonly client: ModelAccessorBusClient = {
    onAccessorChanged: (subscriptionId) => {
      this.subscriptions
        .filter((sub) => sub.id === subscriptionId)
        .forEach((sub) => sub.onAccessorChanged(sub.accessorId));
    },
    closeSubscription: (id) => {
      this.unsubscribe(id);
    },
  };

  protected delegate: ModelAccessorBusProtocol;

  setModelAccessorBus(modelAccessorBus: ModelAccessorBusProtocol) {
    this.delegate = modelAccessorBus;
  }

  /**
   * List of internal subscriptions.
   */
  protected readonly subscriptions: MabProviderSubscription[] = [];

  getSubscriptions = (): MabProviderSubscription[] => this.subscriptions;

  async subscribe(
    context: string,
    accessorId: string,
    onAccessorChanged: ProviderChangeListener
  ): Promise<ProviderChangeSubscriptionToken> {
    const token = await this.delegate.subscribe(context, accessorId);

    const subscription: MabProviderSubscription = {
      id: token.id,
      accessorId: accessorId,
      onAccessorChanged: onAccessorChanged,
      close: () => {
        const index = this.subscriptions.findIndex(
          (sub) => sub === subscription
        );
        if (index >= 0) {
          this.subscriptions.splice(index, 1);
        }
        return index >= 0;
      },
    };

    this.subscriptions.push(subscription);

    return token;
  }

  unsubscribe(subscriptionId: number): void {
    // Close removed sub.
    const removedSub = this.subscriptions.find(
      (sub) => sub.id === subscriptionId
    );
    removedSub?.close();
  }
}
