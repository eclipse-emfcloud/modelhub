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

import { ProviderChangeListener } from '@eclipse-emfcloud/model-accessor-bus';
import { inject, injectable } from '@theia/core/shared/inversify';
import {
  ModelAccessorBusProtocol,
  ProviderChangeSubscriptionToken,
} from '../common';
import { FrontendModelAccessorBusSubscriber } from './frontend-model-accessor-bus-subscriber';

export const FrontendModelAccessorBus = Symbol('FrontendModelAccessorBus');

/**
 * A {@link ModelAccessorBus} projected from the Theia backend in which all
 * of its methods are asynchronous over the RPC channel. This
 * frontend model accessor bus can be used in the frontend exactly as the
 * Model Accessor Bus would be in the backend, except that it does not
 * provide access to backend-only capabilities such as:
 *
 * - register a provider
 * - unregister a provider
 *
 * It allows to subscribe and unsubscribe to notifications from providers and accessors.
 */
export interface FrontendModelAccessorBus {
  /**
   * Subscribe to model accessor bus notifications.
   *
   * @param accessorId the accessor ID to which to subscribe, or * to subscribe to all providers/accessors
   */
  subscribe(
    accessorId: string,
    onAccessorChanged: (id: string) => void
  ): Promise<ProviderChangeSubscriptionToken>;

  /**
   * Unsubscribe to a model accessor bus subscription.
   *
   * @param subscriptionId A number identifying a unique subscription to close
   */
  unsubscribe(subscriptionId: number): void;

  /**
   * Calls an accessor through the {@link ModelAccessorBusProtocol}.
   *
   * @param {string} accessorId The string uniquely identifying the accessor.
   * @param {array} parameters An optional list of parameters. The expected list of parameters depends on the accessor.
   * @returns undefined if the accessor has not been found. Depending on its implementation, an accessor may return undefined as well.
   * @throws if the list of provided arguments does not match the accessor requirements.
   */
  get<T>(accessorId: string, ...parameters: unknown[]): Promise<T | undefined>;
}

@injectable()
export class FrontendModelAccessorBusImpl implements FrontendModelAccessorBus {
  @inject(ModelAccessorBusProtocol)
  protected readonly modelAccessorBusProtocol: ModelAccessorBusProtocol;

  @inject(FrontendModelAccessorBusSubscriber)
  protected readonly delegate: FrontendModelAccessorBusSubscriber;

  /**
   * Model Hub Context provided by the parent {@link FrontendModelHub}.
   */
  protected context = '';

  setContext(newContext: string) {
    this.context = newContext;
  }

  unsubscribe(subscriptionId: number): void {
    this.delegate.unsubscribe(subscriptionId);
  }

  async subscribe(
    providerId: string,
    onAccessorChanged: ProviderChangeListener
  ): Promise<ProviderChangeSubscriptionToken> {
    return this.delegate.subscribe(this.context, providerId, onAccessorChanged);
  }

  async get<T>(
    accessorId: string,
    ...parameters: unknown[]
  ): Promise<T | undefined> {
    return this.modelAccessorBusProtocol.get(
      this.context,
      accessorId,
      ...parameters
    );
  }
}
