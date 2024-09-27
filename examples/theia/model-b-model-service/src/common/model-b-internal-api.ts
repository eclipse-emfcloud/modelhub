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
import { ModelB } from '@eclipse-emfcloud-example/model-b-api';
import { ModelManager } from '@eclipse-emfcloud/model-manager';

export const ModelBInternalAPI = Symbol('ModelBInternalAPI');
export const MODEL_B_INTERNAL_API_PATH = '/services/model-b/internal-api';

export type SetPropertyAction = {
  type: 'set';
  key: keyof ModelB;
  value: unknown;
};

export type UnsetPropertyAction = {
  type: 'unset';
  key: keyof ModelB;
};

export type ModelUpdateAction = SetPropertyAction | UnsetPropertyAction;

export interface ModelBInternalAPI {
  updateModel(
    modelURI: string,
    commandStackId: string,
    action: ModelUpdateAction
  ): Promise<void>;

  unloadModel(modelURI: string): Promise<void>;

  /**
   * Called by the model service contribution to register its model manager.
   */
  addModelManager(context: string, modelManager: ModelManager<string>): void;

  /**
   * Called by the model service contribution to deregister its model manager.
   */
  removeModelManager(context: string, modelManager: ModelManager<string>): void;
}

/** Event notifying of the creation of a `ModelHub` in the backend. */
export interface ModelHubCreatedEvent {
  /** The context of the model hub that was created. */
  context: string;
}

/** Internal client interface for the `ModelBInternalAPI` RPC server. */
export interface ModelBInternalClient {
  /**
   * Notifies the client that a `ModelHub` was created for some project context.
   */
  onModelHubCreated(event: ModelHubCreatedEvent): void;
}
