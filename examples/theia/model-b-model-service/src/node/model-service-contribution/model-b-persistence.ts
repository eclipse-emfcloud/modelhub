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
import {
  MODEL_B_MODEL_ID,
  ModelB,
} from '@eclipse-emfcloud-example/model-b-api';
import { ModelPersistenceContribution } from '@eclipse-emfcloud/model-service';
import { WorkspaceServer } from '@theia/workspace/lib/common';
import { readFile, writeFile } from 'fs/promises';

export function createPersistenceContribution(
  workspaceServer: WorkspaceServer
): ModelPersistenceContribution<string, ModelB> {
  return new ModelAPersistenceContribution(workspaceServer);
}

class ModelAPersistenceContribution
  implements ModelPersistenceContribution<string, ModelB>
{
  constructor(private workspaceServer: WorkspaceServer) {}
  async canHandle(modelId: string): Promise<boolean> {
    // We use Theia workspace service to access files by workspace-relative path
    const root = await this.workspaceServer.getMostRecentlyUsedWorkspace();
    if (!root) {
      return false;
    }
    const url = new URL(modelId, root);
    return url.pathname.endsWith(MODEL_B_MODEL_ID);
  }
  async loadModel(modelId: string): Promise<ModelB> {
    const root = await this.workspaceServer.getMostRecentlyUsedWorkspace();
    const modelPath = new URL(modelId).pathname;
    const content = await readFile(new URL(modelPath, root), {
      encoding: 'utf-8',
    });
    const result = JSON.parse(content);
    return result;
  }
  async saveModel(modelId: string, model: ModelB): Promise<boolean> {
    const root = await this.workspaceServer.getMostRecentlyUsedWorkspace();
    const content = JSON.stringify(model);
    const modelPath = new URL(modelId).pathname;
    await writeFile(new URL(modelPath, root), content, {
      encoding: 'utf-8',
    });
    return true;
  }
}
