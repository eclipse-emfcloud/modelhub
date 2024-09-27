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

import type { ChangeSubscription } from './change-subscription';
import type { CoreCommandStack } from './core-command-stack';

/**
 * A manager of models, providing a {@link CoreCommandStack} with which to
 * edit them and {@link ChangeSubscription}s with which to monitor them
 * for changes.
 *
 * @template K the type of key with which a model is associated
 */
export interface CoreModelManager<K> {
  /**
   * Retrieve a model by its ID.
   *
   * @template M the type of model object that is to be retrieved
   *
   * @param modelId the key for which to retrieve a model, unique within this manager
   * @returns the associated model, or `undefined` if none is registered under the
   *    given ID
   */
  getModel<M extends object = object>(modelId: K): M | undefined;

  /**
   * Query the ID of a `model`.
   *
   * @param model a model object for which to look up the key
   * @returns the key under which the `model` is managed, if indeed it is managed here
   */
  getModelId(model: object): K | undefined;

  /**
   * Query the IDs of models currently maintained in this model manager.
   *
   * @returns the IDs of all managed models, or an empty array if none
   */
  getModelIds(): K[];

  /**
   * Register a model under an unique ID.
   * If a model is already registered under this ID, an exception is thrown.
   *
   * @param modelId the key for which to store the `model`, unique within this manager
   * @param model the model to associate with the given ID
   * @throws if the `modelId` is already associated with a model
   */
  setModel(modelId: K, model: object): void;

  /**
   * Remove the registration of the model for a given ID.
   * Has no effect if no model was registered with that ID.
   *
   * @template M the type of model object that is managed
   *
   * @param modelId the key for which to remove the associated model from this manager
   * @returns the removed model, or `undefined` if no model was associated with the given key
   */
  removeModel<M extends object = object>(modelId: K): M | undefined;

  /**
   * Get the {@link CoreCommandStack} for editing the models that I manage.
   *
   * @returns the command stack
   */
  getCommandStack(): CoreCommandStack<K>;

  /**
   * Create a subscription to the changes occurring in a particular model or on all models.
   * Each call creates a new subscription that, when no longer needed, [should be closed]{@link ChangeSubscription#close} separately.
   *
   * If a `modelId` is specified, notifications of changes only in that model will be sent to the
   * resulting subscription.
   * Otherwise, it will receive notification of changes to all models.
   *
   * The `modelId` needs not necessarily be associated with any model at the time of subscription.
   * The subscription will simply never receive notifications until such time as the model does exist and then changes.
   *
   * @template M the type of model object that changes
   *
   * @param [modelId] the optional model ID to which to subscribe.
   *    If omitted or `undefined`, the subscription will notify on changes to all models that I manage
   * @returns the change subscription
   */
  subscribe<M extends object = object>(modelId?: K): ChangeSubscription<K, M>;
}
