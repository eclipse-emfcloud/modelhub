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
  Container,
  injectable,
  interfaces,
} from '@theia/core/shared/inversify';
import {
  ModelAccessorBusClient,
  ModelAccessorBusProtocol,
  ProviderChangeSubscriptionToken,
} from '../../common';
import {
  FrontendModelAccessorBusSubscriber,
  FrontendModelAccessorBusSubscriberImpl,
} from '../frontend-model-accessor-bus-subscriber';

/**
 * All that we need for testing are the subscription-related methods and `get()`.
 */
@injectable()
export class FakeModelAccessorBusProtocol implements ModelAccessorBusProtocol {
  protected nextSubscriptionId = 0;
  protected readonly subscriptions = new Map<
    number,
    ProviderChangeSubscriptionToken
  >();

  protected client: ModelAccessorBusClient | undefined;

  protected readonly pendingSubs = <
    Promise<ProviderChangeSubscriptionToken>[]
  >[];

  subscribe(
    _context: string,
    accessorId: string
  ): Promise<ProviderChangeSubscriptionToken> {
    const token = {
      id: ++this.nextSubscriptionId,
      accessorId: accessorId,
    };
    this.subscriptions.set(token.id, token);

    const result = Promise.resolve(token);
    this.pendingSubs.push(result);
    return result;
  }

  closeSubscription(token: ProviderChangeSubscriptionToken): void {
    this.subscriptions.delete(token.id);
    this.client?.closeSubscription(token.id);
  }

  /**
   * (fake) get function that returns the first parameter given
   *
   * @param _context not used
   * @param _accessorId not used
   * @param parameters a list of parameters (can be empty)
   * @returns the first parameter given
   */
  async get<T>(
    _context: string,
    _accessorId: string,
    ...parameters: unknown[]
  ): Promise<T | undefined> {
    return parameters[0] as T | undefined;
  }

  setClient(client: ModelAccessorBusClient): void {
    this.client = client;
  }

  get pendingSubsReady(): Promise<void> {
    return Promise.allSettled(this.pendingSubs).then(() => {
      this.pendingSubs.length = 0;
    });
  }

  protected lookupSubs(accessorId: string): ProviderChangeSubscriptionToken[] {
    const result: ProviderChangeSubscriptionToken[] = [];

    if (!this.client) {
      // No point
      return result;
    }

    for (const token of this.subscriptions.values()) {
      if (token.accessorId === accessorId) {
        result.push(token);
      }
    }

    return result;
  }
}

export function bindFakeModelAccessorBusProtocol(
  binder: interfaces.Bind | Container
): void {
  const bind = binder instanceof Container ? binder.bind.bind(binder) : binder;
  bind(FakeModelAccessorBusProtocol).toSelf().inSingletonScope();
  bind(ModelAccessorBusProtocol).toService(FakeModelAccessorBusProtocol);
}

export function connectClient(
  modelAccessorBus: FakeModelAccessorBusProtocol,
  subscriber: FrontendModelAccessorBusSubscriber
): void {
  const subscriberImpl = subscriber as FrontendModelAccessorBusSubscriberImpl;
  modelAccessorBus.setClient(subscriberImpl.client);
  subscriberImpl.setModelAccessorBus(
    modelAccessorBus as unknown as ModelAccessorBusProtocol
  );
}
