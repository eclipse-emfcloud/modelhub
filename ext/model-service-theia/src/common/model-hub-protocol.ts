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
  ModelHub as _ModelHub,
  ModelHubSubscription as _ModelHubSubscription,
  ModelServiceSubscription as _ModelServiceSubscription,
} from '@eclipse-emfcloud/model-service';
import { Diagnostic } from '@eclipse-emfcloud/model-validation';
import { Operation } from 'fast-json-patch';

export const ModelHubProtocolServicePath =
  '/services/eclipse-emfcloud/model-service-theia/model-hub';

/**
 * Inversify injection key for the frontend model hub.
 */
export const ModelHubProtocol = Symbol('ModelHubProtocol');

/**
 * Remote protocol over the RPC bridge to the {@link _ModelHub ModelHub} in the backend.
 *
 * @template K the type of model identifiers that serve as keys to set and retrieve them
 */
export interface ModelHubProtocol<K = string> {
  /**
   * Obtain the raw content of the identified model.
   * If the model has not yet been loaded from persistent storage, it is first loaded.
   * If the model does not exist or it could not be loaded, the returned promise will be rejected.
   *
   * @template M the type of model object expected to be retrieved
   *
   * @param context the model hub context
   * @param modelId the model to retrieve
   * @returns the model
   */
  getModel<M extends object = object>(context: string, modelId: K): Promise<M>;
  /**
   * Create a subscription for notification of model changes and other events pertaining to models.
   * The resulting token represents a subscription in the backend {@link _ModelHub | ModelHub}
   * that sends notifications back over the RPC channel to the {@link ModelHubClient}.
   *
   * @param context the model hub context
   * @param modelIds identifiers of specific models to which to subscribe, or none to subscribe to all models
   * @returns an open subscription token
   */
  subscribe(
    context: string,
    ...modelIds: K[]
  ): Promise<ModelServiceSubscriptionToken<K>>;
  /**
   * Close a subscription.
   *
   * @param token token representing the subscription to close
   */
  closeSubscription(token: ModelServiceSubscriptionToken<K>): Promise<void>;
  /**
   * Perform a new validation of the identified models.
   *
   * @param context the model hub context
   * @param modelIds identifiers of specific models to validate, or none to validate all models
   * @returns a diagnostic describing the new validation state of the requested models
   *
   * @see {@link getValidationState}
   */
  validateModels(context: string, ...modelIds: K[]): Promise<Diagnostic>;
  /**
   * Query the last known validation state of the identified models.
   *
   * @param context the model hub context
   * @param modelIds identifiers of specific models for which to get the current validation state,
   *  or none get the validation state of all models
   * @returns a diagnostic describing the last validation state of the requested models.
   *  Any models that had not yet been validated at the time of this call are not included in
   *  the result. At the extreme, if none of the requested models has yet been validated, the
   *  result is `undefined`
   *
   * @see {@link validateModels}
   */
  getValidationState(
    context: string,
    ...modelIds: K[]
  ): Promise<Diagnostic | undefined>;
  /**
   * Ensure that the models edited by the identified command stacks are saved to persistent storage.
   * Command stacks may not be saved if it is not necessary to do so, for example because they
   * {@link isDirty are not dirty}.
   * On successful save, the corresponding command stacks are marked as saved.
   *
   * @param context the model hub context
   * @param commandStackIds identifiers of specific command stacks to save, or none to save all
   * @returns whether any dirty command stacks were saved (`false` if none of the indicated command
   *  stacks was dirty at the time of the call). On failure to save, the result is a rejected promise
   *
   * @see {@link isDirty}
   */
  save(context: string, ...commandStackIds: string[]): Promise<boolean>;
  /**
   * Query whether the identified command stack is dirty.
   *
   * @param context the model hub context
   * @param commandStackId identifier of a command stack
   * @returns the delegated `isDirty` of the corresponding command stack
   *
   * @see {@link save}
   */
  isDirty(context: string, commandStackId: string): Promise<boolean>;
  /**
   * Undo the last command executed or redone on the identified command stack.
   * If the command stack does not exist or has no command to undo, then the
   * method has no effect.
   *
   * @param context the model hub context
   * @param commandStackId the unique identifier of the command stack to undo
   * @returns whether the command stack had a command that could be undone and it
   *  was successfully undone
   *
   * @see {@link redo}, {@link flush}
   */
  undo(context: string, commandStackId: string): Promise<boolean>;
  /**
   * Redo the last command undone on the identified command stack.
   * If the command stack does not exist or has no command to redo, then the
   * method has no effect.
   *
   * @param context the model hub context
   * @param commandStackId the unique identifier of the command stack to redo
   * @returns whether the command stack had a command that could be redone and it
   *  was successfully redone
   *
   * @see {@link undo}, {@link flush}
   */
  redo(context: string, commandStackId: string): Promise<boolean>;
  /**
   * Flush the undo/redo history of the identified command stack.
   * If the command stack does not exist or has no commands to flush, then
   * the method has no effect.
   *
   * @param context the model hub context
   * @param commandStackId the unique identifier of the command stack to flush
   * @returns whether the command stack had any commands to be flushed and
   *  they were successfully flushed
   *
   * @see {@link undo}, {@link redo}
   */
  flush(context: string, commandStackId: string): Promise<boolean>;
}

/**
 * A serializable token representing a subscription in the backend {@link _ModelHub | ModelHub}
 * that sends notifications back over the RPC channel to the {@link ModelHubClient}.
 */
export interface ModelServiceSubscriptionToken<K = string> {
  /** The unique identifier of the subscription. */
  id: number;
  /**
   * The model IDs to which the subscription is restricted, or none
   * if the subscription is notifying on all models.
   */
  modelIds?: K[];
}

/**
 * Protocol of the frontend-side client object of the {@link ModelHubProtocol} service
 * that receive notifications from the backend on subscription events and on the comings
 * and goings of the model hubs, themselves.
 */
export interface ModelHubClient<K = string> {
  /**
   * RPC analogue of the {@link _ModelServiceSubscription.onModelChanged | ModelServiceSubscription.onModelChanged}
   * call-back.
   */
  onModelChanged(subscriptionId: number, modelId: K, patch?: Operation[]): void;
  /**
   * RPC analogue of the {@link _ModelServiceSubscription.onModelDirtyState | ModelServiceSubscription.onModelDirtyState}
   * call-back.
   */
  onModelDirtyState(subscriptionId: number, modelId: K, dirty: boolean): void;
  /**
   * RPC analogue of the {@link _ModelServiceSubscription.onModelValidated | ModelServiceSubscription.onModelValidated}
   * call-back.
   */
  onModelValidated(
    subscriptionId: number,
    modelId: K,
    diagnostic: Diagnostic
  ): void;
  /**
   * RPC analogue of the {@link _ModelServiceSubscription.onModelLoaded | ModelServiceSubscription.onModelLoaded}
   * call-back.
   */
  onModelLoaded(subscriptionId: number, modelId: K): void;
  /**
   * RPC analogue of the {@link _ModelServiceSubscription.onModelUnloaded | ModelServiceSubscription.onModelUnloaded}
   * call-back.
   */
  onModelUnloaded(subscriptionId: number, modelId: K): void;
  /**
   * RPC analogue of the {@link _ModelHubSubscription.onModelHubDisposed | ModelHubSubscription.onModelHubDisposed}
   * call-back.
   */
  onModelHubDisposed(subscriptionId: number): void;
  /**
   * RPC analogue of the {@link _ModelServiceSubscription.close | ModelServiceSubscription.close}
   * call-back.
   */
  closeSubscription(id: number): void;

  //
  // Model Hub tracking
  //

  /**
   * Notifies the creation and ready availability of a model hub in the backend
   * for the given context.
   */
  onModelHubCreated(context: string): void;
  /**
   * Notifies the destruction and cessation of availability of a model hub in the backend
   * for the given context.
   */
  onModelHubDestroyed(context: string): void;
}
