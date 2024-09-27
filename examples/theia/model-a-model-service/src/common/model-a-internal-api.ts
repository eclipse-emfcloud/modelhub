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
import { ModelA } from '@eclipse-emfcloud-example/model-a-api';
import { ModelManager } from '@eclipse-emfcloud/model-manager';

export const ModelAInternalAPI = Symbol('ModelAInternalAPI');
export const MODEL_A_INTERNAL_API_PATH = '/services/model-a/internal-api';

export type SetPropertyAction = {
  type: 'set';
  key: keyof ModelA;
  value: unknown;
};

export type UnsetPropertyAction = {
  type: 'unset';
  key: keyof ModelA;
};

export type ModelUpdateAction = SetPropertyAction | UnsetPropertyAction;

export interface ModelAInternalAPI {
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
