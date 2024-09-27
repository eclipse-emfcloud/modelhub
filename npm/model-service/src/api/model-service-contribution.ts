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
  Provider,
} from '@eclipse-emfcloud/model-accessor-bus';
import { ModelManager } from '@eclipse-emfcloud/model-manager';
import {
  ModelValidationService,
  Validator,
} from '@eclipse-emfcloud/model-validation';
import { ModelHub } from './model-hub';
import { ModelTrigger } from './model-trigger';

/**
 * Interface for an entity that contributes configuration and business logic
 * specific to a particular model or models to the {@link ModelHub}.
 * The hub delegates persistence and validation to the relevant contributions
 * provided by a model service contribution and clients of the hub may
 * access public model APIs via the provided {@link getModelService model service API}.
 */
export interface ModelServiceContribution<
  K = string,
  M extends object = object
> {
  /**
   * An identifier for the contribution.
   * Must be unique within a {@link ModelHub}.
   */
  readonly id: string;
  /**
   * The model persistence contribution to which the {@link ModelHub} delegates
   * loading and saving of models.
   */
  readonly persistenceContribution: ModelPersistenceContribution<K, M>;
  /**
   * The model validation contribution which the {@link ModelHub} uses to obtain
   * validators for configuration of the model validation service.
   */
  readonly validationContribution?: ModelValidationContribution<K, M>;
  /**
   * The model trigger contribution which the {@link ModelHub} uses to obtain
   * triggers for configuration of the model trigger patching engine.
   */
  readonly triggerContribution?: ModelTriggerContribution<K, M>;
  /**
   * The model accessor contribution which the {@link ModelHub} uses to obtain
   * providers for configuration of the model accessor bus.
   */
  readonly modelAccessorContribution?: ModelAccessorContribution;
  /**
   * Obtain a specific public API for access to and manipulation of the models
   * contributed by this model service contribution.
   *
   * @template S the public API interface type to retrieve
   * @returns the public model API
   */
  getModelService<S = unknown>(): S;
  /**
   * Injects the model manager that the {@link ModelHub} uses to manage models.
   * This lets the model service contribution configure its {@link getModelService model service API}
   * with access to its models, should that be necessary.
   *
   * @param modelManager the hub's model manager
   */
  setModelManager(modelManager: ModelManager<K>): void;
  /**
   * Injects the model validation service that the {@link ModelHub} uses to validate models.
   * This lets the model service contribution configure its {@link getModelService model service API}
   * with access to model validation state, should that be necessary.
   *
   * @param validationService the hub's model validation service
   */
  setValidationService(validationService: ModelValidationService<K>): void;
  /**
   * Informs the model service contribution of the {@link ModelHub} to which it has been contributed.
   * At the time of this call, the hub is full configured and ready for any and all use,
   * including access to other model service contributions' {@link getModelService public APIs}.
   *
   * @param modelHub the model hub to which the model service contribution has been contributed
   */
  setModelHub(modelHub: ModelHub<K>): void;

  /**
   * Injects the model accessor bus that the {@link ModelHub} uses for communication between
   * model services.
   * This lets the model service contribution configure the {@link getModelService model service API}
   * with access to the accessor bus, should that be necessary.
   *
   * @param modelAccessorBus the hub's model accessor bus
   */
  setModelAccessorBus(modelAccessorBus: ModelAccessorBus): void;

  /**
   * Optional call-back for the `ModelHub` that owns the contribution to invoke when it is
   * itself disposed, for an opportunity to clean up any resources held by the contribution.
   */
  dispose?(): void;
}

/**
 * Interface to which the {@link ModelHub} delegates loading and saving of models
 * from/to the persistence store used by the {@link ModelServiceContribution} providing it.
 */
export interface ModelPersistenceContribution<
  K = string,
  M extends object = object
> {
  /**
   * Queries whether the persistence contribution is the one to which loading or saving
   * of a model shall be delegated. The {@link ModelHub} will always check this before
   * requesting load or save and, on returning `true`, the contribution must fulfill the
   * load or save request.
   *
   * @param modelId identification of a model that is to be loaded or saved
   * @returns whether the contribution implements loading and saving of the identified model
   */
  canHandle(modelId: K): Promise<boolean>;
  /**
   * Loads a model from persistent storage.
   * The {@link ModelHub} will only call this method if a prior call to
   * {@link canHandle} for this `modelId` returned `true`.
   *
   * @param modelId identification of a model to load
   * @returns a promise of the loaded model
   */
  loadModel(modelId: K): Promise<M>;
  /**
   * Saves a model to persistent storage.
   * The {@link ModelHub} will only call this method if a prior call to
   * {@link canHandle} for this `modelId` returned `true`.
   *
   * @param modelId identification of a model to save
   * @param model the model to save
   * @returns `true` if the model needed to be saved and was successfully saved;
   *  `false` if the model did not need to be saved, or
   *  a rejected promise if the model needed to be saved and save failed
   */
  saveModel(modelId: K, model: M): Promise<boolean>;
}

/**
 * Interface to which the {@link ModelHub} delegates validation of models.
 */
export interface ModelValidationContribution<
  K = string,
  M extends object = object
> {
  /**
   * Obtain validators to install in the model validation service.
   * As the validation service applies all registered validators to all of its models,
   * the validators returned by this method are free to provide diagnostics for any
   * and all models.
   *
   * The recommended practice is that a validator returns an `ok()` diagnostic
   * for every model ID that it does not recognize, analyzing and diagnosing only the
   * models for model IDs associated with the {@link ModelServiceContribution}
   * providing that validator.
   *
   * @returns zero or more validators to install in the model validation service
   */
  getValidators(): Validator<K, M>[];
}

/**
 * Interface to which the {@link ModelHub} delegates triggered patching of models.
 */
export interface ModelTriggerContribution<
  K = string,
  M extends object = object
> {
  /**
   * Obtain triggers to install in the model's trigger engine to provide
   * proactive model integrity for computed values and other dependencies.
   * As the trigger engine applies all registered triggers to every model,
   * the triggers returned by this method are free to provide patches for any
   * and all models.
   *
   * The recommended practice is that a trigger returns `undefined`
   * for every model ID that it does not recognize, analyzing and computing patches
   * only for the models corresponding to model IDs associated with the
   * {@link ModelServiceContribution} providing that trigger.
   *
   * Triggers are installed into the _Trigger Engine_ in the order in which they
   * are listed in the returned array. This means that triggers are free to
   * implement interdependencies if that is helpful; in particular, a trigger may
   * reliably depend on another trigger having run before it if that trigger is
   * listed before it in this array.
   *
   * @returns zero or more triggers to install in the model trigger engine
   */
  getTriggers(): ModelTrigger<K, M>[];
}

export interface ModelAccessorContribution {
  /**
   * Obtain providers to register in the model accessor bus, to provide
   * synchronization between different models.
   *
   * @returns zero or more providers to register in the model accessor bus
   */
  getProviders(): Provider[];
}

const nullPersistenceContribution: <
  K = string,
  M extends object = object
>() => ModelPersistenceContribution<K, M> = () => ({
  canHandle: () => Promise.resolve(false),
  async loadModel() {
    throw new Error("Unsupported operation 'loadModel'");
  },
  async saveModel() {
    throw new Error("Unsupported operation 'saveModel'");
  },
});

export abstract class AbstractModelServiceContribution<
  K = string,
  M extends object = object
> implements ModelServiceContribution<K, M>
{
  private _id: string;
  private _persistenceContribution: ModelPersistenceContribution<K, M>;
  private _validationContribution?: ModelValidationContribution<K, M>;
  private _triggerContribution?: ModelTriggerContribution<K, M>;
  private _modelAccessorContribution?: ModelAccessorContribution;

  protected modelManager: ModelManager<K>;
  protected validationService: ModelValidationService<K>;
  protected modelHub: ModelHub<K>;
  protected modelAccessorBus: ModelAccessorBus;

  /**
   * Initializes me with my required unique identifier and, optionally,
   * contribution delegates for persistence support and model validation.
   */
  protected initialize({
    id,
    persistenceContribution,
    validationContribution,
    triggerContribution,
    modelAccessorContribution,
  }: {
    id: string;
    persistenceContribution?: ModelPersistenceContribution<K, M>;
    validationContribution?: ModelValidationContribution<K, M>;
    triggerContribution?: ModelTriggerContribution<K, M>;
    modelAccessorContribution?: ModelAccessorContribution;
  }): void {
    this._id = id;
    this._persistenceContribution =
      persistenceContribution ?? nullPersistenceContribution();
    this._validationContribution = validationContribution;
    this._triggerContribution = triggerContribution;
    this._modelAccessorContribution = modelAccessorContribution;
  }

  get id(): string {
    return this._id;
  }

  get persistenceContribution(): ModelPersistenceContribution<K, M> {
    return this._persistenceContribution;
  }

  get validationContribution(): ModelValidationContribution<K, M> | undefined {
    return this._validationContribution;
  }

  get triggerContribution(): ModelTriggerContribution<K, M> | undefined {
    return this._triggerContribution;
  }

  get modelAccessorContribution(): ModelAccessorContribution | undefined {
    return this._modelAccessorContribution;
  }

  setModelManager(modelManager: ModelManager<K>): void {
    this.modelManager = modelManager;
  }

  setModelHub(modelHub: ModelHub<K>): void {
    this.modelHub = modelHub;
  }

  setValidationService(validationService: ModelValidationService<K>): void {
    this.validationService = validationService;
  }

  setModelAccessorBus(modelAccessorBus: ModelAccessorBus): void {
    this.modelAccessorBus = modelAccessorBus;
  }

  abstract getModelService<S>(): S;
}
