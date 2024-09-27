// *****************************************************************************
// Copyright (C) 2024 STMicroelectronics.
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
import { ModelManager } from '@eclipse-emfcloud/model-manager';
import { ModelHub } from '@eclipse-emfcloud/model-service';
import { ModelValidationService } from '@eclipse-emfcloud/model-validation';

/**
 * A contribution of application-specific creation, initialization, and
 * disposal (the full lifecycle) of {@link ModelHub}s.
 */
export interface ModelHubLifecycleContribution<K = string> {
  /**
   * For the ordering of competing lifecycle contributions for contexts of the same
   * kind, an optional calculation the result of which decides the contribution to
   * apply for a `context`. An optional protocol.
   *
   * @param context the context for which a model hub is to be created
   * @returns the contribution's priority. The contribution returning the greatest
   *    priority is used to manage the model hub lifecycle for the `context`.
   *    A contribution that does not implement this method implicitly returns zero.
   *    A result of `NaN` opts the contribution out of the model hub lifecycle.
   */
  getPriority?(context: string): number;

  /**
   * Gets the model hub for a given `context`. If no such hub yet
   * exists, it is {@link createModelHub created and initialized}.
   *
   * @param context the application-specific context for which to create a model hub
   * @param modelManager the hub's model manager
   * @param modelValidationService the hub's validation service
   * @param modelAccessorBus the hub's model accessor bus
   * @returns the `context`'s model hub
   */
  createModelHub(
    context: string,
    modelManager: ModelManager<K>,
    modelValidationService: ModelValidationService<K>,
    modelAccessorBus: ModelAccessorBus
  ): ModelHub<K, string>;

  /**
   * Initializes the given model hub. An optional post-construction protocol.
   *
   * @param modelHub a model hub to initialize
   * @returns a promise that resolves when the model hub is ready to use
   */
  initializeModelHub?(modelHub: ModelHub<K, string>): Promise<void>;

  /**
   * Destroys the given model hub. An optional protocol.
   *
   * @param modelHub a model hub no longer in use
   */
  disposeModelHub?(modelHub: ModelHub<K, string>): void;
}

/** Service identifier for name of the Model Hub lifecycle contribution. */
export const ModelHubLifecycleContribution = Symbol(
  'ModelHubLifecycleContribution'
);
