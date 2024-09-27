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
import { ModelHubManager } from '@eclipse-emfcloud/model-service-theia/lib/node/model-hub-manager';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import {
  ContainerModule,
  inject,
  injectable,
} from '@theia/core/shared/inversify';
import { WorkspaceServer } from '@theia/workspace/lib/common';
import { readdir, stat } from 'fs/promises';

export default new ContainerModule((bind) => {
  bind(ExampleApplicationContribution).toSelf().inSingletonScope(); // For testability
  bind(BackendApplicationContribution).toService(
    ExampleApplicationContribution
  );
});

@injectable()
export class ExampleApplicationContribution
  implements BackendApplicationContribution
{
  @inject(WorkspaceServer)
  private workspaceServer: WorkspaceServer;

  @inject(ModelHubManager)
  private readonly modelHubManager: ModelHubManager;

  onStart(): void {
    this.readProjects().catch((e) => {
      console.error(e);
    });
  }
  async readProjects(): Promise<void> {
    const rootUrl = await this.workspaceServer.getMostRecentlyUsedWorkspace();
    if (rootUrl === undefined) {
      throw Error('No workspace loaded!');
    }
    const root = new URL(rootUrl);

    const dirContent = await readdir(root.pathname);
    const stats = await Promise.all(
      dirContent.map(async (f) => {
        return {
          path: `${root.toString()}/${f}`,
          folderName: f,
          stat: await stat(`${root.pathname}/${f}`),
        };
      })
    );
    const directories = stats.filter(
      (s) => s.stat.isDirectory() && !s.folderName.startsWith('.')
    );
    directories.forEach((d) => {
      this.modelHubManager.provideModelHub(d.path);
    });
  }

  onStop(): void {}
}
