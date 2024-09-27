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

import { ModelAccessorBus as _ModelAccessorBus } from '@eclipse-emfcloud/model-accessor-bus';

export const ModelAccessorBusProtocolServicePath =
  '/services/eclipse-emfcloud/model-service-theia/model-accessor-bus';

/**
 * Inversify injection key for the frontend model accessor bus.
 */
export const ModelAccessorBusProtocol = Symbol('ModelAccessorBusProtocol');

/**
 * Remote protocol over the RPC bridge to the {@link _ModelAccessorBus ModelAccessorBus} in the backend.
 */
export interface ModelAccessorBusProtocol {
  /**
   * Create a subscription for notifications from one or several accessors, from one provider in a specific ModelHub context.
   * The resulting token represents a subscription in the backend {@link _ModelAccessorBus | ModelAccessorBus}
   * that sends notifications back over the RPC channel to the {@link ModelAccessorBusClient}.
   *
   * @param {string} context A string identifying a single ModelHub context.
   * @param {string} id A string identifying a single or a set of accessors.
   *  If '*' is provided, the subscription applies to all accessors from all providers.
   *  If 'xxx' is provided, the subscription applies to all accessors the id of which starts with "xxx"
   * @returns {Promise<ProviderChangeSubscriptionToken>}
   */
  subscribe(
    context: string,
    id: string
  ): Promise<ProviderChangeSubscriptionToken>;

  /**
   * Close a subscription.
   *
   * @param token The token containing the subscription to close
   */
  closeSubscription(token: ProviderChangeSubscriptionToken): void;

  /**
   * Calls an accessor.
   * @param {string} accessorId The sting uniquely identifying the accessor.
   * @param {array} parameters An optional list of parameters. The expected list of parameters depends on the accessor.
   * @returns undefined if the accessor has not been found. Depending on its implementation, an accessor may return undefined as well.
   * @throws if the list of provided arguments does not match the accessor requirements.
   */
  get<T>(accessorId: string, ...parameters: unknown[]): Promise<T | undefined>;
}

export interface ModelAccessorBusClient {
  /**
   * RPC method triggered on accessor changed.
   */
  onAccessorChanged(subscriptionId: number): void;

  /**
   * RPC analogue of the {@link _ProviderChangeSubscription.close | ProviderChangeSubscription.close}
   * method.
   */
  closeSubscription(id: number): void;
}

/**
 * A serializable token representing a subscription in the backend {@link _ModelAccessorBus | ModelAccessorBus}
 * that sends notifications back over the RPC channel to the {@link ModelAccessorBusClient}.
 */
export interface ProviderChangeSubscriptionToken {
  /**
   * The unique identifier of the subscription.
   */
  id: number;

  /**
   * The accessor Id to which the subscription is restricted.
   */
  accessorId: string;
}
