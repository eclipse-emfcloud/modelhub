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
  ModelHub,
  ModelHubSubscription,
} from '@eclipse-emfcloud/model-service';
import { Diagnostic } from '@eclipse-emfcloud/model-validation';
import { ILogger } from '@theia/core';
import {
  inject,
  injectable,
  postConstruct,
} from '@theia/core/shared/inversify';
import { ModelHubProtocol } from '../common';
import {
  FrontendModelAccessorBus,
  FrontendModelAccessorBusImpl,
} from './frontend-model-accessor-bus';
import { FrontendModelHubSubscriber } from './frontend-model-hub-subscriber';

/**
 * Dependency injection key for the Frontend Model Hub provider.
 */
export const FrontendModelHubProvider = Symbol('FrontendModelHubProvider');
export type FrontendModelHubProvider<K = string> = (
  context: string
) => Promise<FrontendModelHub<K>>;

/**
 * Transformation of a synchronous method signature to an
 * asynchronous one returning a promise of the original
 * return type.
 */
type MakeAsync<T> = //
  T extends (...args: unknown[]) => unknown
    ? ReturnType<T> extends Promise<unknown>
      ? T
      : (...args: Parameters<T>) => Promise<ReturnType<T>>
    : never;

/** Helper type to extract the keys that are of method type. */
type MethodKeysOf<T> = {
  [K in keyof T]: T[K] extends (...args: unknown[]) => unknown ? K : never;
}[keyof T];

/**
 * A {@link ModelHub} projected from the Theia backend in which all
 * of its methods are asynchronous over the RPC channel. This
 * frontend model hub can be used in the front end exactly as the
 * Model Hub would be in the backend, except that it does not
 * provide access to backend-only capabilities such as:
 *
 * - model service contributions (especially adding them)
 * - public model service APIs
 * - the context defining the Model Hub's scope
 * - live validation engagement
 *
 * All other capabilities, such as retrieving models, saving
 * them, checking dirty state, validating, undo/redo, are
 * supported.
 */
export type FrontendModelHub<K = string> = {
  [key in Exclude<
    MethodKeysOf<ModelHub<K, string>>,
    | 'dispose'
    | 'addModelServiceContribution'
    | 'getModelService'
    | 'liveValidation'
    | 'getModelAccessorBus'
  >]: MakeAsync<ModelHub<K, string>[key]>;
} & {
  readonly context: string;
  readonly isDisposed: boolean;
  getModelAccessorBus: () => FrontendModelAccessorBus;
};

export const FrontendModelHubContext = Symbol('FrontendModelHubContext');

@injectable()
export class FrontendModelHubImpl<K = string> implements FrontendModelHub<K> {
  @inject(FrontendModelHubContext)
  public readonly context: string;

  @inject(ModelHubProtocol)
  protected readonly delegate: ModelHubProtocol<K>;

  @inject(FrontendModelHubSubscriber)
  protected readonly subscriber: FrontendModelHubSubscriber<K>;

  @inject(FrontendModelAccessorBus)
  protected readonly modelAccessorBus: FrontendModelAccessorBusImpl;

  @inject(ILogger)
  protected readonly logger: ILogger;

  private disposed = false;

  @postConstruct()
  protected initialize(): void {
    this.doInitialize().catch((reason) =>
      this.logger.error('Failed to initialize FrontendModelHub.', reason)
    );
  }

  protected async doInitialize(): Promise<void> {
    // Self-subscribe to learn of disposal
    const sub = await this.subscriber.subscribe(this.context);
    sub.onModelHubDisposed = () => (this.disposed = true);
  }

  //
  // Model Hub protocol
  //

  get isDisposed(): boolean {
    return this.disposed;
  }

  async subscribe<M extends object = object>(
    ...modelIds: K[]
  ): Promise<ModelHubSubscription<K, M>> {
    const subscription = this.subscriber.subscribe(this.context, ...modelIds);
    return subscription;
  }

  //
  // Model Accessor Bus getter
  //

  getModelAccessorBus(): FrontendModelAccessorBus {
    this.modelAccessorBus.setContext(this.context);
    return this.modelAccessorBus;
  }

  //
  // Model Hub protocol by simple delegation
  //

  async getModel<M extends object = object>(modelId: K): Promise<M> {
    return this.subscriber.getModel(this.context, modelId);
  }

  validateModels(...modelIds: K[]): Promise<Diagnostic> {
    return this.delegate.validateModels(this.context, ...modelIds);
  }

  getValidationState(...modelIds: K[]): Promise<Diagnostic | undefined> {
    return this.delegate.getValidationState(this.context, ...modelIds);
  }

  save(...commandStackIds: string[]): Promise<boolean> {
    return this.delegate.save(this.context, ...commandStackIds);
  }

  isDirty(commandStackId: string): Promise<boolean> {
    return this.delegate.isDirty(this.context, commandStackId);
  }

  undo(commandStackId: string): Promise<boolean> {
    return this.delegate.undo(this.context, commandStackId);
  }

  redo(commandStackId: string): Promise<boolean> {
    return this.delegate.redo(this.context, commandStackId);
  }

  flush(commandStackId: string): Promise<boolean> {
    return this.delegate.flush(this.context, commandStackId);
  }
}
