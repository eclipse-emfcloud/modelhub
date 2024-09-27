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
  FrontendModelHub,
  FrontendModelHubProvider,
} from '@eclipse-emfcloud/model-service-theia/lib/browser';
import {
  AbstractViewContribution,
  CommonCommands,
} from '@theia/core/lib/browser';
import { CommandRegistry } from '@theia/core/lib/common';
import { inject, injectable } from '@theia/core/shared/inversify';
import { isAddressBookModelId } from '../common';
import '../src/style.css';
import { AddressBookWidget } from './address-book-widget';

const addressBookWidgetId = 'example:address-book';

@injectable()
export class AddressBookViewContribution extends AbstractViewContribution<AddressBookWidget> {
  private modelHub: FrontendModelHub<string>;
  private dirty = false;

  constructor(
    @inject(FrontendModelHubProvider)
    modelHub: FrontendModelHubProvider<string>
  ) {
    super({
      widgetId: addressBookWidgetId,
      widgetName: 'Address Book',
      defaultWidgetOptions: { area: 'main', mode: 'split-left' },
    });

    modelHub(addressBookWidgetId).then(async (hub) => {
      this.modelHub = hub;
      const subscription = await hub.subscribe();
      subscription.onModelDirtyState = (
        modelId: string,
        _model: unknown,
        dirty: boolean
      ) => {
        if (isAddressBookModelId(modelId)) {
          this.dirty = dirty;
        }
      };
    });
  }

  registerCommands(commands: CommandRegistry): void {
    commands.registerHandler(CommonCommands.SAVE.id, {
      isEnabled: () => {
        const currentWidget = this.shell.currentWidget;
        return (
          this.dirty &&
          currentWidget !== undefined &&
          currentWidget.id === addressBookWidgetId
        );
      },
      execute: () => {
        this.modelHub.save(addressBookWidgetId);
      },
    });

    commands.registerHandler(CommonCommands.UNDO.id, {
      isEnabled: () => {
        const currentWidget = this.shell.currentWidget;
        return (
          currentWidget !== undefined &&
          currentWidget.id === addressBookWidgetId
        );
      },
      execute: () => {
        this.modelHub.undo(addressBookWidgetId);
      },
    });

    commands.registerHandler(CommonCommands.REDO.id, {
      isEnabled: () => {
        const currentWidget = this.shell.currentWidget;
        return (
          currentWidget !== undefined &&
          currentWidget.id === addressBookWidgetId
        );
      },
      execute: () => {
        this.modelHub.redo(addressBookWidgetId);
      },
    });
  }
}
