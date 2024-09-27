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

import { ModelAccessorBusImpl } from '@eclipse-emfcloud/model-accessor-bus';
import {
  createModelServiceModelManager,
  ModelHub,
  ModelHubImpl,
  ModelServiceContribution,
} from '@eclipse-emfcloud/model-service';
import { ModelValidationServiceImpl } from '@eclipse-emfcloud/model-validation';
import { ContributionProvider, Stopwatch } from '@theia/core';
import {
  inject,
  injectable,
  named,
  optional,
} from '@theia/core/shared/inversify';
import { retryUntilFulfilled, timeout } from '../common';
import {
  ModelHubTracker,
  ModelHubTrackingSubscription,
} from '../common/model-hub-tracker';
import { ModelHubLifecycleContribution } from './model-hub-lifecycle-contribution';

/**
 * A mediator service that creates and manages instances of the
 * {@link ModelHub}, binding the application-defined
 * {@link ModelServiceContribution}s into them.
 * Clients will never have to interact with this service.
 */
export interface ModelHubManager<K = string> {
  /**
   * Gets the model hub for a given `context`. If no such hub yet
   * exists, it is created.
   *
   * @param context the model hub context that defines, in some application-specific way,
   *   the scope of the models managed in the hub
   * @returns the `context`'s model hub
   *
   * @see {@link provideModelHub}
   * @see {@link initializeContext}
   */
  getModelHub(context: string): ModelHub<K, string>;

  /**
   * Initializes the given model hub context.
   * If initialization already took place, this will be a no-op.
   *
   * @param context a model hub context to initialize
   * @returns a promise that resolves when the model hub is ready to use
   *  or rejects if initialization either fails or times out
   */
  initializeContext(context: string): Promise<ModelHub<K, string>>;

  /**
   * Provide a model hub for the given `context` that is asynchronously
   * initialized. If initialization fails (including by timeout), then
   * the resulting project will be rejected.
   */
  provideModelHub(context: string): Promise<ModelHub<K, string>>;

  /**
   * Destroys the model hub, if any, for the given `context`.
   * Should only be done for a `context` that is known no longer
   * to be legitimately usable.
   *
   * @param context a context no longer in use
   */
  disposeContext(context: string): void;
}

/** Service identifier for the Model Hub manager. */
export const ModelHubManager = Symbol('ModelHubManager');

/**
 * Factory type for ModelServiceContributions. This Factory returns a new
 * list of contribution instances every time it is invoked, ensuring
 * that Contributions are not used in multiple contexts at the same time.
 */
export type ModelServiceContributionFactory<K = string> =
  () => ModelServiceContribution<K>[];

/**
 * Dependency injection symbol for ModelServiceContributionFactory.
 */
export const ModelServiceContributionFactory = Symbol(
  'ModelServiceContributionFactory'
);

interface ModelHubRecord<K> {
  modelHub: ModelHub<K, string>;
  lifecycle: ModelHubLifecycleContribution<K>;
  initialized: boolean;
  pendingInitialization?: Promise<ModelHub<K, string>>;
}

@injectable()
export class DefaultModelHubManager<K = string>
  implements ModelHubManager<K>, ModelHubTracker
{
  @inject(ModelServiceContributionFactory)
  protected modelServiceContributionFactory: ModelServiceContributionFactory;

  @inject(ContributionProvider)
  @named(ModelHubLifecycleContribution)
  protected modelHubLifecycleContributions: ContributionProvider<
    ModelHubLifecycleContribution<K>
  >;

  @optional()
  @inject(Stopwatch)
  protected stopwatch: Stopwatch | undefined;

  private readonly initializationTimeoutMs = 30_000;

  private readonly modelHubs = new Map<string, ModelHubRecord<K>>();

  private readonly trackingSubscriptions: ModelHubTrackingSubscription[] = [];

  /* Model hub lifecycle to use when there are no applicable contributions. */
  private readonly defaultModelHubLifecycle: ModelHubLifecycleContribution<K> =
    {
      createModelHub: (
        ...args: ConstructorParameters<typeof ModelHubImpl<K, string>>
      ) => new ModelHubImpl(...args),
    };

  getModelHub(context: string): ModelHub<K, string> {
    let result = this.modelHubs.get(context)?.modelHub;
    if (!result) {
      result = this.createModelHub(context);
    }
    return result;
  }

  async provideModelHub(context: string): Promise<ModelHub<K, string>> {
    const result = this.getModelHub(context);

    try {
      await this.initializeContext(context);
    } catch (error) {
      // Forget this record. The next attempt to provide the model hub will start over
      try {
        result.dispose();
      } finally {
        this.modelHubs.delete(context);
      }
      throw error;
    }

    return result;
  }

  disposeContext(context: string): void {
    const record = this.modelHubs.get(context);
    this.modelHubs.delete(context);

    if (record) {
      if (record.lifecycle.disposeModelHub) {
        record.lifecycle.disposeModelHub(record.modelHub);
      } else {
        record.modelHub.dispose();
      }
    }
  }

  /**
   * Creates and initializes a new model hub for a given `context`.
   *
   * @param context the model hub context that defines, in some application-specific way, the scope of the models managed in the hub
   * @returns the `context`'s model hub
   */
  createModelHub(context: string): ModelHub<K, string> {
    const modelManager = createModelServiceModelManager<K>();
    const validationService = new ModelValidationServiceImpl<K>();
    const modelAccessorBus = new ModelAccessorBusImpl();

    // Get the lifecycle contribution to use to create the Model Hub
    const [_, lifecycle] = this.modelHubLifecycleContributions
      .getContributions()
      .reduce(
        ([prevPrio, prev], curr) => {
          const currPrio = curr.getPriority?.(context) ?? 0;
          return !isNaN(currPrio) && currPrio > prevPrio
            ? [currPrio, curr]
            : [prevPrio, prev];
        },
        [-Infinity, this.defaultModelHubLifecycle]
      );

    // Create the Model Hub
    const result = lifecycle.createModelHub(
      context,
      modelManager,
      validationService,
      modelAccessorBus
    );

    const contribute = (contribution: ModelServiceContribution<unknown>) =>
      result.addModelServiceContribution(
        contribution as ModelServiceContribution<K>
      );
    const configure = (contribution: ModelServiceContribution<unknown>) =>
      (contribution as ModelServiceContribution<K>).setModelHub(result);

    const contributions = this.modelServiceContributionFactory();

    // Add all contributions to the Model Hub
    contributions.forEach(contribute);

    // All contributions are added, so make it known to model services
    contributions.forEach(configure);

    this.modelHubs.set(context, {
      modelHub: result,
      lifecycle,
      initialized: false,
    });

    return result;
  }

  async initializeContext(context: string): Promise<ModelHub<K, string>> {
    const record = this.modelHubs.get(context);

    if (!record) {
      throw new Error(`No model hub exists for context ${context}.`);
    }

    if (record.pendingInitialization === undefined) {
      if (!record.lifecycle.initializeModelHub) {
        // Nothing to initialize, so just toggle it
        record.initialized = true;
        record.pendingInitialization = Promise.resolve(record.modelHub);
        this.notifyModelHubCreated(context);
      } else {
        const measurement = this.stopwatch?.start(`initialize model hub`, {
          thresholdMillis: 500,
          context: `model hub '${context}`,
        });

        const initializeModelHub = record.lifecycle.initializeModelHub;
        record.pendingInitialization = retryUntilFulfilled(() => {
          const initializedModelHub = initializeModelHub
            .call(record.lifecycle, record.modelHub)
            .then(() => record.modelHub);

          return timeout(
            initializedModelHub,
            this.initializationTimeoutMs,
            (outcome) => {
              if (outcome === 'timeout') {
                measurement?.error('timed out');
                return (
                  'Model Hub initialization timed out for context: ' + context
                );
              } else if (outcome instanceof Error) {
                measurement?.error('failed', outcome);
              } else {
                record.initialized = true;
                this.notifyModelHubCreated(context);
                measurement?.log('complete');
              }
              return undefined;
            }
          );
        });
      }
    }

    const result = await record.pendingInitialization;
    const disposeSub = result.subscribe();
    disposeSub.onModelHubDisposed = () => this.notifyModelHubDestroyed(context);
    return result;
  }

  //
  // Model hub tracking
  //

  private notifyModelHubCreated(context: string) {
    this.trackingSubscriptions.forEach((sub) =>
      sub.onModelHubCreated?.(context)
    );
  }

  private notifyModelHubDestroyed(context: string) {
    this.trackingSubscriptions.forEach((sub) =>
      sub.onModelHubDestroyed?.(context)
    );
  }

  trackModelHubs(): ModelHubTrackingSubscription {
    let _onModelHubCreated: ModelHubTrackingSubscription['onModelHubCreated'];
    const modelHubs = this.modelHubs;

    const result: ModelHubTrackingSubscription = {
      close: () => {
        const index = this.trackingSubscriptions.indexOf(result);
        if (index >= 0) {
          this.trackingSubscriptions.splice(index, 1);
        }
      },

      get onModelHubCreated() {
        return _onModelHubCreated;
      },
      set onModelHubCreated(onModelHubCreated) {
        _onModelHubCreated = onModelHubCreated;
        if (onModelHubCreated) {
          modelHubs.forEach((record, context) => {
            if (record.initialized) {
              onModelHubCreated(context);
            }
          });
        }
      },
    };

    this.trackingSubscriptions.push(result);
    return result;
  }

  isModelHubAvailable(context: string): boolean {
    return this.modelHubs.get(context)?.initialized === true;
  }
}
