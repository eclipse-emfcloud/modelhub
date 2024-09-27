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

export type Accessor = (...parameters: unknown[]) => unknown;

export interface Provider {
  /**
   * The provider identifier
   * This string will be the exposed prefix of all provider's accessors.
   */
  readonly id: string;

  /**
   * Runs the accessors and retrieve the associated value
   * @param id the accessor identifier
   * @param parameters An optional list of parameters to be used
   * @returns the value described by the accessors, according to the provided arguments. Will returned undefined if the accessor has not been found.
   */
  get<T>(id: string, ...parameters: unknown[]): T | undefined;

  /**
   * Creates a subscription to this provider
   * @param onModelChanged the callback to trigger when the provider must notify about the related model change.
   * @change a subscription object, which allows to close the subscription, meaning the onModelChanged callback won't be called anymore.
   */
  subscribe(onModelChanged: ProviderChangeListener): ProviderChangeSubscription;

  /**
   * Allows to trigger the onModelChanged callback to all subscribers.
   * @param id A string giving information on the accessors which should be worth calling again.
   *           If id is not provided, the notification will be propagated to all registered subscriptions.
   */
  notify(id?: string): void;

  /**
   * @returns the list of accessors currently supported by the provider.
   * This is a test-dedicated API.
   */
  getAccessors(): string[];
}

export class DefaultProvider implements Provider {
  protected readonly accessors: Map<string, Accessor> = new Map();
  protected subscriptions: {
    subscription: ProviderChangeSubscription;
    onModelChanged: ProviderChangeListener;
  }[] = [];

  constructor(public readonly id: string) {}

  get<T>(id: string, ...parameters: unknown[]): T | undefined {
    const accessor = this.accessors.get(id);
    if (accessor) {
      return accessor(...parameters) as T;
    }
    return undefined;
  }

  subscribe(
    onModelChanged: ProviderChangeListener
  ): ProviderChangeSubscription {
    const subscription: ProviderChangeSubscription = {
      close: () => this.deleteSubscription(subscription),
    };
    this.subscriptions.push({ subscription, onModelChanged });
    return subscription;
  }

  notify(id?: string): void {
    this.subscriptions.forEach((sub) => sub.onModelChanged(id ?? ''));
  }

  private deleteSubscription(subscription: ProviderChangeSubscription) {
    this.subscriptions = this.subscriptions.filter(
      (s) => s.subscription !== subscription
    );
  }

  getAccessors(): string[] {
    return [...this.accessors.keys()];
  }
}
