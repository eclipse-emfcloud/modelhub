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
import { FrontendModelHubProvider } from '@eclipse-emfcloud/model-service-theia/lib/browser';
import {
  CommonCommands,
  KeybindingContribution,
  KeybindingRegistry,
  WidgetOpenHandler,
  WidgetOpenerOptions,
} from '@theia/core/lib/browser';
import {
  Command,
  CommandContribution,
  CommandHandler,
  CommandRegistry,
  MenuContribution,
  MenuModelRegistry,
  MessageService,
  SelectionService,
  URI,
  isOSX,
} from '@theia/core/lib/common';
import { inject, injectable } from '@theia/core/shared/inversify';
import { FileSelection } from '@theia/filesystem/lib/browser/file-selection';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileStat } from '@theia/filesystem/lib/common/files';
import { NavigatorContextMenu } from '@theia/navigator/lib/browser/navigator-contribution';
import { getApplicationProjectURI } from '../common/util';
import { appReady } from './frontend-contribution';
import { ModelFormWidget, ModelFormWidgetOptions } from './model-form-widget';

interface WidgetOpenerOptionsWithProjectName extends WidgetOpenerOptions {
  projectName?: string;
}

@injectable()
export abstract class ModelFormWidgetContribution<
    W extends ModelFormWidget<NonNullable<object>>
  >
  extends WidgetOpenHandler<W>
  implements CommandContribution, KeybindingContribution, MenuContribution
{
  public abstract readonly id: string;

  protected abstract readonly modelID: string;

  protected abstract readonly modelName: string;

  protected abstract readonly openModelCommand: Command;

  @inject(FrontendModelHubProvider)
  private readonly modelHub: FrontendModelHubProvider<string>;

  @inject(SelectionService)
  private readonly selectionService: SelectionService;

  @inject(MessageService)
  private readonly messageService: MessageService;

  @inject(FileService)
  private readonly fileService: FileService;

  canHandle(uri: URI, _options?: WidgetOpenerOptions): number {
    const modelURI = uri.toString();
    return modelURI === this.modelID ? 100 : 0;
  }

  async open(
    uri: URI,
    options?: WidgetOpenerOptionsWithProjectName | undefined
  ): Promise<W> {
    await appReady;
    return super.open(uri, options);
  }

  protected createWidgetOptions(
    uri: URI,
    options?: WidgetOpenerOptionsWithProjectName
  ): ModelFormWidgetOptions {
    const modelURI = uri.toString();
    const id = `${this.id}:${modelURI.toString()}`;
    const title = `${this.modelName} - ${
      options?.projectName ?? '<unknown project>'
    }`;
    return { modelURI, id, title };
  }

  protected async openModelView(filestat: FileStat): Promise<void> {
    const projectFile = await this.getApplicationProject(filestat);
    const projectURI = projectFile;
    if (!projectURI) {
      return this.messageService
        .warn('No application project selected.')
        .then();
    }
    const modelURI = `${projectURI.resource.path.toString()}/${
      projectFile.name
    }.${this.modelID}`;

    const projectName = await this.getProjectName(projectFile.resource);
    const widgetOptions = { area: 'main', mode: 'split-right' } as const;
    this.open(new URI(modelURI), { widgetOptions, projectName });
  }

  protected abstract getProjectName(
    projectResource: URI
  ): Promise<string | undefined>;

  protected async getApplicationProject(
    filestat: FileStat
  ): Promise<FileStat | undefined> {
    if (filestat.isDirectory) {
      return filestat;
    }
    const parentURI = filestat.resource.parent;
    const parentDir =
      parentURI.path && (await this.fileService.resolve(parentURI));
    if (parentDir) {
      return this.getApplicationProject(parentDir);
    } else {
      return undefined;
    }
  }

  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand(
      this.openModelCommand,
      new FileSelection.CommandHandler(this.selectionService, {
        multi: false,
        execute: (fileSelection) => this.openModelView(fileSelection.fileStat),
      })
    );

    commands.registerHandler(
      CommonCommands.UNDO.id,
      this.modelWidgetCommandHandler({
        execute: (currentWidget: W) =>
          this.modelHub(getApplicationProjectURI(currentWidget.modelURI)).then(
            (hub) => hub.undo(this.id)
          ),
      })
    );

    commands.registerHandler(
      CommonCommands.REDO.id,
      this.modelWidgetCommandHandler({
        execute: (currentWidget: W) =>
          this.modelHub(getApplicationProjectURI(currentWidget.modelURI)).then(
            (hub) => hub.redo(this.id)
          ),
      })
    );
  }

  get currentModelWidget(): W | undefined {
    const currentWidget = this.shell.currentWidget;
    if (!(currentWidget instanceof ModelFormWidget)) {
      return undefined;
    }
    const modelURI = currentWidget.modelURI;
    const expectedID = `${this.id}:${modelURI}`;
    if (currentWidget.id !== expectedID) {
      return undefined;
    }
    return currentWidget as W;
  }

  private modelWidgetCommandHandler(handler: CommandHandler): CommandHandler {
    return {
      execute: (...args) => {
        const currentWidget = this.currentModelWidget;
        if (currentWidget) {
          return handler.execute?.(currentWidget, ...args);
        }
        return undefined;
      },
      isEnabled: (...args) => {
        const currentWidget = this.currentModelWidget;
        if (currentWidget) {
          return handler.isEnabled?.(currentWidget, ...args) ?? true;
        }
        return false;
      },
      isVisible: (...args) => {
        const currentWidget = this.currentModelWidget;
        if (currentWidget) {
          return handler.isVisible?.(currentWidget, ...args) ?? true;
        }
        return false;
      },
    };
  }

  registerKeybindings(keybindings: KeybindingRegistry): void {
    keybindings.registerKeybindings(
      {
        command: CommonCommands.UNDO.id,
        keybinding: 'ctrlcmd+z',
      },
      {
        command: CommonCommands.REDO.id,
        keybinding: isOSX ? 'shift+cmd+z' : 'ctrl+y',
      }
    );
  }

  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(NavigatorContextMenu.MODIFICATION, {
      commandId: this.openModelCommand.id,
      label: `Open ${this.modelName}`,
      order: `0_${this.modelID}`,
    });
  }
}
