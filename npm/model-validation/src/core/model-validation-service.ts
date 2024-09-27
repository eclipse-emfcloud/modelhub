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

import isEqual from 'lodash/isEqual';
import { Diagnostic, merge } from './diagnostic';
import { ValidationSubscription } from './validation-subscription';
import { Validator } from './validator';

/**
 * A service for validation of models. The validation algorithm is
 * delegated to pluggable {@link Validator}s. The service maintains the
 * last validation state computed for every model for retrieval at
 * any time.
 *
 * @template K the type of model identifier by which validation state is tracked
 */
export interface ModelValidationService<K> {
  /**
   * Add a validator to which the service shall delegate model validation.
   *
   * @param validator a validator to add to the service
   */
  addValidator<M extends object = object>(validator: Validator<K, M>): void;

  /**
   * Compute the validation state of the given `model`.
   * The validation service is not required to support validation of sub-models
   * or individual elements of a model.
   *
   * @param modelId the unique identifier of the `model` to validate
   * @param model the model to validate
   * @returns the `model`'s validation state
   */
  validate(modelId: K, model: object): Promise<Diagnostic>;

  /**
   * Obtain the current validation state of the given `model`, being that which
   * was most recently computed.
   *
   * @param modelId the unique identifier of a model
   * @returns the indicated model's most recent validation state, or `undefined`
   *   if none has yet been computed for it
   */
  getValidationState(modelId: K): Diagnostic | undefined;

  /**
   * Create a new subscription for notification of updates to the validation
   * state of models. If no `modelIds` are provided, then the subscription
   * will be notified of validation updates for all models tracked by this
   * validation manager. Otherwise, the subscription will be notified only
   * for the specific models identified.
   *
   * @template M the type of model to which to subscribe for validation updates
   *
   * @param modelIds zero or more model IDs to filter the subscription on
   * @returns the subscription
   */
  subscribe<M extends object = object>(
    ...modelIds: K[]
  ): ValidationSubscription<K, M>;
}

export class ModelValidationServiceImpl<K>
  implements ModelValidationService<K>
{
  private readonly _validators = new Array<Validator<K, object>>();
  private readonly _validationState = new Map<K, Diagnostic>();
  private readonly _subscriptions = new Map<K, ValidationSubscription<K>[]>();
  private readonly _subscriptionsToAllModels = new Array<
    ValidationSubscription<K>
  >();

  addValidator<M extends object = object>(validator: Validator<K, M>): void {
    this._validators.push(validator);
  }

  async validate(modelId: K, model: object): Promise<Diagnostic> {
    const diagnosticPromises: Promise<Diagnostic>[] = [];
    this._validators.forEach((validator) => {
      try {
        diagnosticPromises.push(validator.validate(modelId, model));
      } catch (err) {
        console.warn(
          `An error occurred within a validator during the validation of '${modelId}'. ${err.name}: ${err.message}. Validation continues ignoring the failed validator`
        );
        return;
      }
    });
    const diag = await Promise.allSettled(diagnosticPromises);
    const diagnostics: Diagnostic[] = [];
    diag.forEach((values) => {
      if (values.status === 'fulfilled') {
        diagnostics.push(values.value);
      } else {
        console.warn(
          `An error occurred within a validator during the validation of '${modelId}' (cause: ${values.reason}). Validation continues ignoring the failed validator`
        );
        console.warn(values.reason);
      }
    });

    const result = merge(...diagnostics);
    const previousState = this.getValidationState(modelId);
    if (!isEqual(result, previousState)) {
      this._validationState.set(modelId, result);
      this._subscriptions.get(modelId)?.forEach((subscription) => {
        try {
          subscription.onValidationChanged?.(modelId, model, result);
        } catch (err) {
          console.warn(
            `An error occurred within the onValidationChanged callback for '${modelId}'. ${err.name}: ${err.message}. Other subscribers will still be notified ignoring the failed callback`
          );
        }
      });
      this._subscriptionsToAllModels.forEach((subscription) => {
        try {
          subscription.onValidationChanged?.(modelId, model, result);
        } catch (err) {
          console.warn(
            `An error occurred within the onValidationChanged callback for '${modelId}'. ${err.name}: ${err.message}. Other subscribers will still be notified ignoring the failed callback`
          );
        }
      });
    }
    return result;
  }

  getValidationState(modelId: K): Diagnostic | undefined {
    return this._validationState.get(modelId);
  }

  subscribe<M extends object = object>(
    ...modelIds: K[]
  ): ValidationSubscription<K, M> {
    let subscription: ValidationSubscription<K, M>;
    if (modelIds.length) {
      subscription = {
        close: () => this.deleteSubscription(subscription),
      };
      for (const modelId of modelIds) {
        this.addSubscription(modelId, subscription);
      }
    } else {
      subscription = {
        close: () => this.deleteAllSubscription(subscription),
      };
      this.addAllSubscription(subscription);
    }
    return subscription;
  }

  private addSubscription(modelId: K, subscription: ValidationSubscription<K>) {
    const existingSubscriptions = this._subscriptions.get(modelId) || [];
    existingSubscriptions.push(subscription);
    this._subscriptions.set(modelId, existingSubscriptions);
  }

  private addAllSubscription(subscription: ValidationSubscription<K>) {
    this._subscriptionsToAllModels.push(subscription);
  }

  private deleteSubscription(subscription: ValidationSubscription<K>) {
    this._subscriptions.forEach((subscriptions, modelId) => {
      const index = subscriptions.findIndex((s) => s === subscription);
      if (index > -1) {
        subscriptions.splice(index, 1);
      }
      if (!subscriptions.length) {
        this._subscriptions.delete(modelId);
      }
    });
  }

  private deleteAllSubscription(subscription: ValidationSubscription<K>) {
    const index = this._subscriptionsToAllModels.indexOf(subscription);
    if (index > -1) {
      this._subscriptionsToAllModels.splice(index, 1);
    }
  }
}
