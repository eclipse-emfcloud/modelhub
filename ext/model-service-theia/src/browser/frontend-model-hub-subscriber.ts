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
  ModelHubSubscription,
  ModelServiceSubscription,
} from '@eclipse-emfcloud/model-service';
import { Deferred } from '@theia/core/lib/common/promise-util';
import { injectable } from '@theia/core/shared/inversify';
import { applyPatch, Operation } from 'fast-json-patch';
import {
  ModelHubClient,
  ModelHubProtocol,
  ModelServiceSubscriptionToken,
} from '../common';
import {
  ModelHubTracker,
  ModelHubTrackingSubscription,
} from '../common/model-hub-tracker';
import type { FrontendModelHub as _FrontendModelHub } from './frontend-model-hub';

export const FrontendModelHubSubscriber = Symbol('FrontendModelHubSubscriber');

/**
 * An injectable service for creation of subscriptions to receive
 * notifications of changes in model state in the {@link ModelHubProtocol}.
 * Most clients will not need to use this directly because it is more
 * convenient to use the {@link _FrontendModelHub | FrontendModelHub} API, instead.
 */
export interface FrontendModelHubSubscriber<K = string> {
  /**
   * Subscribe to model hub notifications.
   *
   * @template M the type of model object that is expected to send notifications
   *
   * @param context the model hub context in which to subscribe to models
   */
  subscribe<M extends object = object>(
    context: string
  ): Promise<ModelHubSubscription<K, M>>;
  /**
   * Subscribe to model notifications.
   *
   * @param context the model hub context in which to subscribe to models
   * @param modelIds the models to which to subscribe, or none to subscribe to all
   */
  subscribe<M extends object = object>(
    context: string,
    ...modelIds: K[]
  ): Promise<ModelServiceSubscription<K, M>>;

  /**
   * Get the given model from the local (frontend) cache.
   * If it is not yet cached, it is retrieved from the backend.
   *
   * @param context the model hub context in which to retrieve a model
   * @param modelId the model to retrieve
   */
  getModel<M extends object>(context: string, modelId: K): Promise<M>;
}

/**
 * A subscription registered on the subscriber is augmented by the model IDs that it
 * watches (if any).
 */
type SubscriberSubscription<
  K,
  M extends object = object
> = ModelHubSubscription<K, M> & {
  context: unknown;
  modelIds: K[];
};

/** Utility type requiring some subset of keys in a type. */
type With<T, K extends keyof T> = T & Required<Pick<T, K>>;

@injectable()
export class FrontendModelHubSubscriberImpl<K = string>
  implements FrontendModelHubSubscriber<K>, ModelHubTracker
{
  public readonly client: ModelHubClient<K> = {
    onModelChanged: (subscriptionId, modelId, delta) => {
      this.updateModelCache(subscriptionId, modelId, delta);
      this.lookupSubs(subscriptionId, modelId)?.then(({ subs, model }) =>
        subs.forEach((sub) => sub.onModelChanged?.(modelId, model, delta))
      );
    },
    onModelDirtyState: (subscriptionId, modelId, dirty) => {
      this.lookupSubs(subscriptionId, modelId)?.then(({ subs, model }) =>
        subs.forEach((sub) => sub.onModelDirtyState?.(modelId, model, dirty))
      );
    },
    onModelValidated: (subscriptionId, modelId, diagnostic) => {
      this.lookupSubs(subscriptionId, modelId)?.then(({ subs, model }) =>
        subs.forEach((sub) =>
          sub.onModelValidated?.(modelId, model, diagnostic)
        )
      );
    },
    onModelLoaded: (subscriptionId, modelId) => {
      this.lookupSubs(subscriptionId, modelId)?.then(({ subs }) => {
        subs.forEach((sub) => sub.onModelLoaded?.(modelId));
      });
    },
    onModelUnloaded: (subscriptionId, modelId) => {
      const subs = this.lookupSubs(subscriptionId, modelId);
      if (subs) {
        subs
          .then(({ subs, model }) => {
            subs.forEach((sub) => sub.onModelUnloaded?.(modelId, model));
          })
          .finally(() => this.removeModelCache(subscriptionId, modelId));
      } else {
        this.removeModelCache(subscriptionId, modelId);
      }
    },
    onModelHubDisposed: (subscriptionId) => {
      this.lookupHubSubs(subscriptionId)?.then((subs) => {
        subs.forEach((sub) => sub.onModelHubDisposed());
      });
    },
    closeSubscription: (id) => {
      this.closeSub(id);
    },

    //
    // Model hub tracking
    //

    onModelHubCreated: (context) => {
      this.knownModelHubs.add(context);
      this.trackingSubs.forEach((sub) => sub.onModelHubCreated?.(context));
    },
    onModelHubDestroyed: (context) => {
      this.knownModelHubs.delete(context);
      this.trackingSubs.forEach((sub) => sub.onModelHubDestroyed?.(context));
    },
  };

  protected readonly subscriptions: SubscriberSubscription<K>[] = [];
  protected readonly trackingSubs: ModelHubTrackingSubscription[] = [];

  protected readonly modelCaches = new Map<string, Map<K, object>>();

  protected readonly modelHub = new Deferred<ModelHubProtocol<K>>();
  private readonly knownModelHubs = new Set<string>();

  /**
   * My own subscription to the model hub that implements
   * the pipeline of incremental model caching and client
   * subscription multiplexing.
   */
  private subscriptionPipelines = new Map<
    string,
    ModelServiceSubscriptionToken<K>
  >();

  setModelHub(modelHub: ModelHubProtocol<K>): void {
    this.modelHub.resolve(modelHub);
  }

  /**
   * Look up a subscription and the model that will have to be passed along
   * to any of its call-backs that are subsequently invoked.
   *
   * @param subscriptionId the subscription to look up
   * @param modelId a model to resolve to pass on to the subscription
   * @returns resolved subscription and model, as long as both are resolved
   */
  protected lookupSubs<M extends object>(
    subscriptionId: number,
    modelId: K
  ): Promise<{ subs: ModelServiceSubscription<K>[]; model: M }> | undefined {
    const context = this.getSubscriptionContext(subscriptionId);
    if (context === undefined) {
      return undefined;
    }

    const subs = this.subscriptions.filter(
      (sub) =>
        sub.context === context &&
        (!sub.modelIds.length || sub.modelIds.includes(modelId))
    );
    if (!subs.length) {
      return undefined;
    }

    return this.getModel<M>(context, modelId).then((model) => ({
      subs,
      model,
    }));
  }

  /**
   * Look up a subscription for the purpose of invoking hub lifecycle call-backs.
   * As for now the only call-back is `onModelHubDisposed`, we return only subs
   * that have this call-back.
   *
   * @param subscriptionId the subscription to look up
   * @returns resolved hub subscriptions
   */
  protected lookupHubSubs(
    subscriptionId: number
  ):
    | Promise<With<ModelHubSubscription<K>, 'onModelHubDisposed'>[]>
    | undefined {
    const context = this.getSubscriptionContext(subscriptionId);
    if (context === undefined) {
      return undefined;
    }

    const hasOnModelHubDisposed = (
      sub: SubscriberSubscription<K>
    ): sub is With<SubscriberSubscription<K>, 'onModelHubDisposed'> => {
      return sub.context === context && sub.onModelHubDisposed !== undefined;
    };
    return Promise.resolve(this.subscriptions.filter(hasOnModelHubDisposed));
  }

  private getSubscriptionContext(subscriptionId: number): string | undefined {
    for (const [context, pipeline] of this.subscriptionPipelines) {
      if (subscriptionId === pipeline.id) {
        return context;
      }
    }
    return undefined;
  }

  /**
   * React to the notification from the backend that a subscription
   * was closed on that end by closing the corresponding frontend
   * subscriptions.
   *
   * @param subscriptionId a backend subscription that was closed
   */
  protected closeSub(subscriptionId: number): void {
    const context = this.getSubscriptionContext(subscriptionId);
    if (context !== undefined) {
      this.subscriptionPipelines.delete(context);

      const newSubs = this.subscriptions.filter(
        (sub) => sub.context !== context
      );
      this.subscriptions.length = 0;
      this.subscriptions.push(...newSubs);
    }
  }

  protected updateModelCache(
    subscriptionId: number,
    modelId: K,
    delta?: Operation[]
  ): void {
    const context = this.getSubscriptionContext(subscriptionId);
    if (context === undefined) {
      // Not our subscription: do not update the cache
      return;
    }

    const modelCache = this.getModelCache(context);
    if (delta && delta.length && modelCache.has(modelId)) {
      const model = modelCache.get(modelId);
      try {
        // Because this patch came in over the RPC wire, we don't need
        // to worry about it having references to objects in the model
        // that it changes and so being, itself, changed as a side-effect
        // of applying it to the model.
        // Therefore, we do not need to first clone the patch as recommended
        // by the `applyPatch` API documentation
        applyPatch(model, delta);
      } catch (error) {
        // Invalidate our cache because now we're out of sync
        modelCache.delete(modelId);
        console.warn(
          `Error applying received model delta to frontend model cache ${modelId}. Remove cached model to synchronize on next access.`,
          error
        );
      }
    }
  }

  protected removeModelCache(subscriptionId: number, modelId: K): void {
    const context = this.getSubscriptionContext(subscriptionId);
    if (context === undefined) {
      // Not our subscription: do not update the cache
      return;
    }

    this.getModelCache(context).delete(modelId);
  }

  async getModel<M extends object>(context: string, modelId: K): Promise<M> {
    // Need this to keep model cache updated
    await this.ensureSubscriptionPipeline(context);

    const modelCache = this.getModelCache(context);

    let result: M = modelCache.get(modelId) as M;
    if (result === undefined) {
      const hub = await this.modelHub.promise;
      result = await hub.getModel(context, modelId);
      modelCache.set(modelId, result);
    }
    return result;
  }

  protected getModelCache(context: string): Map<K, object> {
    let result = this.modelCaches.get(context);
    if (result === undefined) {
      result = new Map();
      this.modelCaches.set(context, result);
    }
    return result;
  }

  async subscribe<M extends object = object>(
    context: string,
    ...modelIds: K[]
  ): Promise<ModelHubSubscription<K, M>> {
    await this.ensureSubscriptionPipeline(context);

    const subscription: SubscriberSubscription<K, M> = {
      context,
      modelIds,
      close: () => {
        const index = this.subscriptions.indexOf(subscription);
        if (index >= 0) {
          this.subscriptions.splice(index, 1);
        }
      },
    };

    this.subscriptions.push(subscription);

    return subscription;
  }

  /**
   * Ensure that I am myself subscribed to the model hub to maintain my model cache
   * and multiplex my clients' subscriptions.
   */
  private async ensureSubscriptionPipeline(context: string): Promise<void> {
    if (!this.subscriptionPipelines.has(context)) {
      const hub = await this.modelHub.promise;
      const newPipeline = await hub.subscribe(context);
      this.subscriptionPipelines.set(context, newPipeline);
    }
  }

  //
  // Model hub tracking
  //

  trackModelHubs(): ModelHubTrackingSubscription {
    let _onModelHubCreated: ModelHubTrackingSubscription['onModelHubCreated'];
    const knownModelHubs = this.knownModelHubs;

    const result: ModelHubTrackingSubscription = {
      close: () => {
        const index = this.trackingSubs.indexOf(result);
        if (index >= 0) {
          this.trackingSubs.splice(index, 1);
        }
      },

      get onModelHubCreated() {
        return _onModelHubCreated;
      },
      set onModelHubCreated(onModelHubCreated) {
        _onModelHubCreated = onModelHubCreated;
        if (onModelHubCreated) {
          knownModelHubs.forEach((context) => onModelHubCreated(context));
        }
      },
    };

    this.trackingSubs.push(result);
    return result;
  }

  isModelHubAvailable(context: string): boolean {
    return this.knownModelHubs.has(context);
  }
}
