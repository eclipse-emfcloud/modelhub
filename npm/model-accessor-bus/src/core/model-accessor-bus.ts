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
  ProviderChangeListener,
  ProviderChangeSubscription,
} from './change-subscription';
import { Provider } from './provider';

export interface ModelAccessorBus {
  /**
   * Subscribe for notifications from one or several accessors, from one provider.
   * @param {string} id A string identifying a single or a set of accessors.
   *  If '*' is provided, the subscription applies to all accessors from all providers.
   *  If 'xxx' is provided, the subscription applies to all accessors the id of which starts with "xxx"
   * @param {ProviderChangeListener} onAccessorChanged A function to be called when a provider notifies its changes.
   * @returns {ProviderChangeSubscription}
   */
  subscribe(
    id: string,
    onAccessorChanged: ProviderChangeListener
  ): ProviderChangeSubscription;

  /**
   * Registers a provider. Once the provider is registered, its accessors will be callable.
   * @param {Provider} provider The provider to call for accessors processing. The provider attribute "id" will be used to reference the provider and resolve accessors.
   * If a provider id is "x" it contains accessors internally named "a" and "b", a consumer will be able to call:
   * get("x.a") and get("x.b")
   */
  register(provider: Provider): void;

  /**
   * Unregisters a provider. Once the provider is unregistered, its accessors won't be callable anymore.
   * @param {string} providerId A string uniquely identifying the provider to be removed.

   */
  unregister(providerId: string): void;

  /**
   * Calls an accessor.
   * @param {string} accessorId The sting uniquely identifying the accessor.
   * @param {array} parameters An optional list of parameters. The expected list of parameters depends on the accessor.
   * @returns undefined if the accessor has not been found. Depending on its implementation, an accessor may return undefined as well.
   * @throws if the list of provided arguments does not match the accessor requirements.
   */
  get<T>(accessorId: string, ...parameters: unknown[]): T | undefined;
}

/**
 * Implementation for the Model Accessor Bus interface
 */
export class ModelAccessorBusImpl implements ModelAccessorBus {
  /* The set of registered providers, referenced by provider ID (ex: pinout) */
  private providers: Map<string, Provider> = new Map<string, Provider>();

  /* The set of change subscriptions for each provider, referenced by provider ID (ex: pinout)
   * Those subscriptions are used to allow each provider to notify the model accessor bus implementation.
   * They do not support subscription for model services.
   */
  private providerSubscriptions: Map<string, ProviderChangeSubscription> =
    new Map<string, ProviderChangeSubscription>();

  /* The set of change subscriptions for each accessor, referenced by accessor prefix (ex: pinout)
   * Those subscriptions are created for model services.
   * For that reason, there may be several subscriptions for the same accessor.
   */
  private accessorSubscriptions: {
    providerId: string;
    accessorId: string | undefined;
    onAccessorChanged: ProviderChangeListener;
  }[] = [];

  constructor(private separator = '.') {}

  /* Utility function to add accessor subscription to the map */
  private addAccessorSubscription(
    id: string,
    onAccessorChanged: ProviderChangeListener
  ) {
    const { providerId, accessorId } = this.splitSubscriptionId(id);
    this.accessorSubscriptions.push({
      providerId,
      accessorId,
      onAccessorChanged,
    });
  }

  /* Utility function to remove accessor subscription from the map */
  private removeAccessorSubscription(
    id: string,
    onAccessorChanged: ProviderChangeListener
  ) {
    const { providerId, accessorId } = this.splitSubscriptionId(id);
    this.accessorSubscriptions = this.accessorSubscriptions.filter(
      (item) =>
        item.providerId !== providerId ||
        item.accessorId !== accessorId ||
        item.onAccessorChanged !== onAccessorChanged
    );
  }

  /*
   * Allows to trigger model service subscriptions according to the input id.
   * Dispatching matrix:
   * Example: 1. provider id: X
   *             provider accessors: A, B, A.C
   *          2. provider id: Y
   *             provider accessors: M
   * x: subscription onAccessorChanged callback is called
   * -: else
   *
   *   | Subscription pattern | Notification id
   *   |                      |  X  | X.A |X.A.C| X.B |  Y  | Y.M |
   *   |----------------------|-----|-----|-----|-----|-----|-----|
   * 1 | *                    |  x  |  x  |  x  |  x  |  x  |  x  |
   * 2 | X                    |  x  |  x  |  x  |  x  |  -  |  -  |
   * 3 | X.A                  |  x  |  x  |  -  |  -  |  -  |  -  |
   * 4 | X.A.C                |  x  |  -  |  x  |  -  |  -  |  -  |
   * 5 | X.B                  |  x  |  -  |  -  |  x  |  -  |  -  |
   * 6 | Y                    |  -  |  -  |  -  |  -  |  x  |  -  |
   * 7 | Y.M                  |  -  |  -  |  -  |  -  |  -  |  x  |
   */
  private dispatchNotification(providerId: string, accessorId: string) {
    let notificationId = providerId;
    if (accessorId) {
      notificationId += this.separator + accessorId;
    }
    for (const subscription of this.accessorSubscriptions) {
      if (
        subscription.providerId === '*' ||
        (subscription.providerId === providerId &&
          (!subscription.accessorId ||
            !accessorId ||
            subscription.accessorId === accessorId))
      ) {
        subscription.onAccessorChanged(notificationId);
      }
    }
  }

  subscribe(
    id: string,
    onAccessorChanged: ProviderChangeListener
  ): ProviderChangeSubscription {
    const accessorSubscription: ProviderChangeSubscription = {
      close: () => this.removeAccessorSubscription(id, onAccessorChanged),
    };
    this.addAccessorSubscription(id, onAccessorChanged);
    return accessorSubscription;
  }

  register(provider: Provider): void {
    this.providers.set(provider.id, provider);
    const providerSubscription = provider.subscribe((id: string) =>
      this.dispatchNotification(provider.id, id)
    );
    this.providerSubscriptions.set(provider.id, providerSubscription);
  }

  unregister(providerId: string): void {
    this.providers.delete(providerId);
    this.providerSubscriptions.get(providerId)?.close();
  }

  get<T>(accessorId: string, ...parameters: unknown[]): T | undefined {
    const { providerId, accessorId: providerAccessorId } =
      this.splitSubscriptionId(accessorId);
    const provider = this.providers.get(providerId);
    if (provider && providerAccessorId) {
      return provider.get<T>(providerAccessorId, ...parameters);
    }
    return undefined;
  }

  getAllAccessors(): string[] {
    return [...this.providers.values()].reduce(
      (accessors: string[], provider: Provider) => {
        return [
          ...accessors,
          ...provider
            .getAccessors()
            .map((accessor) => provider.id + this.separator + accessor),
        ];
      },
      []
    );
  }

  private splitSubscriptionId(id: string): {
    providerId: string;
    accessorId: string | undefined;
  } {
    let providerId;
    let accessorId = undefined;
    const splitIndex = id.indexOf(this.separator);
    if (splitIndex > -1) {
      providerId = id.substring(0, splitIndex);
      accessorId = id.substring(splitIndex + 1);
    } else {
      providerId = id;
    }
    return { providerId, accessorId };
  }
}
