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

import { ModelAccessorBus } from '@eclipse-emfcloud/model-accessor-bus';
import { ChangeSubscription } from '@eclipse-emfcloud/model-manager';
import {
  Diagnostic,
  ValidationListener,
} from '@eclipse-emfcloud/model-validation';
import { ModelServiceContribution } from './model-service-contribution';

/**
 * The primary point of access to model management facilities for some context.
 * The model hub provides access to
 *
 * - {@link getModelService} — public APIs abstracting the view of and manipulation of models
 * - {@link getModelAccessorBus} - the accessor bus allowing Model Services to communicate with one another
 * - {@link validateModels} — validation of models
 * - {@link getModel} — raw model content for those clients that need it
 * - {@link undo} — undo/redo histories of model edits for those clients that need it
 * - {@link saveModels} — persistence of models for those clients that need it
 *
 * @template K the type of model identifiers that serve as keys to set and retrieve them
 * @template C the type of context that defines the scope of the models maintained in the hub
 */
export interface ModelHub<K = string, C = unknown> {
  /**
   * The application context that defines the scope of models managed in this hub.
   */
  readonly context: C;

  /**
   * Whether models are validated automatically as they are modified by commands.
   * By default, live validation is `true` (turned on).
   */
  liveValidation: boolean;

  /**
   * Dispose any resources held by this model hub, including stopping all subscriptions,
   * disconnecting live validation, flushing command stacks, and clearing out the models.
   */
  dispose(): void;

  /**
   * Whether the model hub has been {@link dispose() disposed}.
   */
  readonly isDisposed: boolean;

  /**
   * Adds a model service contribution that plugs in application-specific behaviour
   * and business logic for one or more models under its control.
   *
   * @template M the type of model object supported by the contribution
   *
   * @param modelServiceContribution a model service contribution to add
   */
  addModelServiceContribution<M extends object = object>(
    modelServiceContribution: ModelServiceContribution<K, M>
  ): void;

  /**
   * Obtain a specific public API for access to and manipulation of the models
   * contributed by an identified model service contribution.
   *
   * @template S the public API interface type to retrieve
   *
   * @param id the identifier of the {@link ModelServiceContribution} providing the requested public API
   * @returns the public model API, if the contribution exists and it provides a public API
   */
  getModelService<S = unknown>(id: string): S | undefined;

  /**
   * Obtain the accessor bus that allows different Model Services to communicate, either by directly
   * retrieving data or by subscribing to notifications for changes produced by other Model Services.
   *
   * @returns the {@link ModelAccessorBus}
   */
  getModelAccessorBus(): ModelAccessorBus;

  /**
   * Obtain the raw content of the identified model.
   * If the model has not yet been loaded from persistent storage, it is first loaded.
   * If the model does not exist or it could not be loaded, the returned promise will be rejected.
   *
   * @template M the type of model object expected to be retrieved
   *
   * @param modelId the model to retrieve
   * @returns the model
   */
  getModel<M extends object = object>(modelId: K): Promise<M>;
  /**
   * Create a subscription for notification of changes in the model hub, itself, or any
   * of its models.
   *
   * @template M the type of model object that is expected to send notifications
   *
   * @returns an open subscription
   */
  subscribe<M extends object = object>(): ModelHubSubscription<K, M>;
  /**
   * Create a subscription for notification of model changes and other events pertaining to models.
   *
   * @template M the type of model object that is expected to send notifications
   *
   * @param modelIds identifiers of specific models to which to subscribe, or none to subscribe to all models
   * @returns an open subscription
   */
  subscribe<M extends object = object>(
    ...modelIds: K[]
  ): ModelServiceSubscription<K, M>;
  /**
   * Perform a new validation of the identified models.
   *
   * @param modelIds identifiers of specific models to validate, or none to validate all models
   * @returns a diagnostic describing the new validation state of the requested models
   *
   * @see {@link getValidationState}
   */
  validateModels(...modelIds: K[]): Promise<Diagnostic>;
  /**
   * Query the last known validation state of the identified models.
   * @param modelIds identifiers of specific models for which to get the current validation state,
   *  or none get the validation state of all models
   * @returns a diagnostic describing the last validation state of the requested models.
   *  Any models that had not yet been validated at the time of this call are not included in
   *  the result. At the extreme, if none of the requested models has yet been validated, the
   *  result is `undefined`
   *
   * @see {@link validateModels}
   */
  getValidationState(...modelIds: K[]): Diagnostic | undefined;
  /**
   * Ensure that the models edited by the identified command stacks are saved to persistent storage.
   * Command stacks may not be saved if it is not necessary to do so, for example because they
   * {@link isDirty are not dirty}.
   * On successful save, the corresponding command stacks are marked as saved.
   *
   * @param commandStackIds identifiers of specific command stacks to save, or none to save all
   * @returns whether any dirty command stacks were saved (`false` if none of the indicated command
   *  stacks was dirty at the time of the call). On failure to save, the result is a rejected promise
   *
   * @see {@link isDirty}
   */
  save(...commandStackIds: string[]): Promise<boolean>;
  /**
   * Query whether the identified command stack is dirty.
   * It is dirty if any of the models that it edits is different to its current persistent state,
   * as determined by whether the command currently at the top of the stack is the _savepoint_.
   *
   * @param commandStackId identifier of a command stack
   * @returns `true` if the current in-memory state of any model edited by the command stack is different to its state in persistent storage;
   *  `false`, otherwise
   *
   * @see {@link save}
   */
  isDirty(commandStackId: string): boolean;
  /**
   * Undo the last command executed or redone on the identified command stack.
   * If the command stack does not exist or has no command to undo, then the
   * method has no effect.
   *
   * @param commandStackId the unique identifier of the command stack to undo
   * @returns whether the command stack had a command that could be undone and it
   *  was successfully undone
   *
   * @see {@link redo}, {@link flush}
   */
  undo(commandStackId: string): Promise<boolean>;
  /**
   * Redo the last command undone on the identified command stack.
   * If the command stack does not exist or has no command to redo, then the
   * method has no effect.
   *
   * @param commandStackId the unique identifier of the command stack to redo
   * @returns whether the command stack had a command that could be redone and it
   *  was successfully redone
   *
   * @see {@link undo}, {@link flush}
   */
  redo(commandStackId: string): Promise<boolean>;
  /**
   * Flush the undo/redo history of the identified command stack.
   * If the command stack does not exist or has no commands to flush, then
   * the method has no effect.
   *
   * @param commandStackId the unique identifier of the command stack to flush
   * @returns whether the command stack had any commands to be flushed and
   *  they were successfully flushed
   *
   * @see {@link undo}, {@link redo}
   */
  flush(commandStackId: string): boolean;
}

/**
 * Interface for a subscription to changes in the state of a model
 * managed by the {@link ModelHub}.
 */
export interface ModelServiceSubscription<K = string, M extends object = object>
  extends ChangeSubscription<K, M> {
  /** An optional callback for model validation events. */
  onModelValidated?: ModelValidatedCallback<K, M>;
  /** An optional callback for model dirty state changes. */
  onModelDirtyState?: ModelDirtyStateChangedCallback<K, M>;
  /** An optional callback for model loaded events. */
  onModelLoaded?: ModelLoadedCallback<K>;
  /** An optional callback for model unloaded events. */
  onModelUnloaded?: ModelUnloadedCallback<K, M>;
}

/**
 * Type of the call-back function for model validation events.
 *
 * @param modelId identifier of the model that was validated
 * @param model the model that was validated
 * @param diagnostic its new validation state
 */
export type ModelValidatedCallback<
  K = string,
  M extends object = object
> = ValidationListener<K, M>;

/**
 * Type of the call-back function for model dirty state changes.
 *
 * @param modelId identifier of the model that changed
 * @param model the model that changed
 * @param dirty its new dirty state, which is `false` if the model is saved or `true` if it is different to its persistent state
 */
export type ModelDirtyStateChangedCallback<
  K = string,
  M extends object = object
> = (modelId: K, model: M, dirty: boolean) => void;

/**
 * Type of the call-back function for model load events.
 * The loaded model is not included in the notification. If the
 * client needs to access the model, it can be retrieved from
 * the notifying Model Hub.
 *
 * @param modelId identifier of the model that was loaded
 */
export type ModelLoadedCallback<K = string> = (modelId: K) => void;

/**
 * Type of the call-back function for modelun load events.
 * The last known state of the model is included in the notification.
 *
 * @param modelId identifier of the model that was unloaded
 * @param model the last known state of the model
 */
export type ModelUnloadedCallback<K = string, M extends object = object> = (
  modelId: K,
  model: M
) => void;

/**
 * Interface for a subscription to changes in the state of the
 * {@link ModelHub}, itself.
 */
export interface ModelHubSubscription<K = string, M extends object = object>
  extends ModelServiceSubscription<K, M> {
  /** Invoked on disposal of the model hub. */
  onModelHubDisposed?: ModelHubDisposedCallback;
}

/**
 * Call-back signature for disposal events on the {@link ModelHubSubscription}.
 */
export type ModelHubDisposedCallback = () => void;
