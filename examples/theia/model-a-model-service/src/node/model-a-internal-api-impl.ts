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
import { getApplicationProjectURI } from '@eclipse-emfcloud-example/model-hub-integration/lib/common/util';
import {
  Command,
  ModelManager,
  createModelUpdaterCommand,
} from '@eclipse-emfcloud/model-manager';
import { Disposable, unreachable } from '@theia/core';
import { injectable } from '@theia/core/shared/inversify';
import { set, unset } from 'lodash';
import { ModelAInternalAPI, ModelUpdateAction } from '../common';

@injectable()
export class ModelAInternalAPIImpl implements ModelAInternalAPI, Disposable {
  private readonly modelManagers = new Map<string, ModelManager<string>>();

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
          (current: ModelA) => set(current, action.key, action.value)
        );
        break;
      case 'unset':
        command = createModelUpdaterCommand(
          `Remove ${action.key} from '${modelURI}`,
          modelURI,
          (current: ModelA) => unset(current, action.key)
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
