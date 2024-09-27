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
import { getApplicationProjectURI } from '@eclipse-emfcloud-example/model-hub-integration/lib/common/util';
import {
  Command,
  createModelUpdaterCommand,
  ModelManager,
} from '@eclipse-emfcloud/model-manager';
import { RpcServer, unreachable } from '@theia/core';
import { injectable } from '@theia/core/shared/inversify';
import { set, unset } from 'lodash';
import {
  ModelBInternalAPI,
  ModelBInternalClient,
  ModelUpdateAction,
} from '../common';

@injectable()
export class ModelBInternalAPIImpl
  implements RpcServer<ModelBInternalClient>, ModelBInternalAPI
{
  private client?: ModelBInternalClient;

  private readonly modelManagers = new Map<string, ModelManager<string>>();

  setClient(client: ModelBInternalClient | undefined): void {
    this.client = client;

    if (this.client) {
      // Let it know about the model hub contexts that we have, so far
      Array.from(this.modelManagers.keys()).forEach((context) =>
        this.client?.onModelHubCreated({ context })
      );
    }
  }

  async updateModel(
    modelURI: string,
    commandStackId: string,
    action: ModelUpdateAction
  ): Promise<void> {
    let command: Command<string>;
    switch (action.type) {
      case 'set':
        command = createModelUpdaterCommand(
          `Update ${action.key} to '${action.value}' in '${modelURI}`,
          modelURI,
          (current: ModelB) => set(current, action.key, action.value)
        );
        break;
      case 'unset':
        command = createModelUpdaterCommand(
          `Remove ${action.key} from '${modelURI}`,
          modelURI,
          (current: ModelB) => unset(current, action.key)
        );
        break;
      default:
        unreachable(action);
    }

    const modelManager = this.getModelManager(modelURI);
    const stack = modelManager?.getCommandStack(commandStackId);
    if (!stack) {
      throw new Error(`No model manager available for model ${modelURI}.`);
    }

    if (await stack.canExecute(command)) {
      await stack.execute(command);
    }
  }

  protected getModelManager(
    modelURI: string
  ): ModelManager<string> | undefined {
    return this.modelManagers.get(getApplicationProjectURI(modelURI));
  }

  async unloadModel(modelURI: string): Promise<void> {
    const modelManager = this.getModelManager(modelURI);
    if (modelManager) {
      [...modelManager.getModelIds()].forEach(
        modelManager.removeModel.bind(modelManager)
      );
    }
  }

  addModelManager(context: string, modelManager: ModelManager<string>): void {
    if (!this.modelManagers.has(context)) {
      this.modelManagers.set(context, modelManager);
      this.client?.onModelHubCreated({ context });
    }
  }

  removeModelManager(
    context: string,
    modelManager: ModelManager<string>
  ): void {
    if (this.modelManagers.get(context) === modelManager) {
      this.modelManagers.delete(context);
    }
  }

  dispose(): void {
    this.modelManagers.clear();
  }
}
