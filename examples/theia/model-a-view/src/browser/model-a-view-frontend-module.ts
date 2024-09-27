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
import { ModelFormWidgetOptions } from '@eclipse-emfcloud-example/model-hub-integration/lib/browser/model-form-widget';
import {
  KeybindingContribution,
  WidgetFactory,
  WidgetOpenHandler,
} from '@theia/core/lib/browser';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { ContainerModule, interfaces } from '@theia/core/shared/inversify';
import { ModelAWidget } from './model-a-widget';
import { ModelAWidgetContribution } from './model-a-widget-contribution';

function bindModelAWidget(bind: interfaces.Bind): void {
  bind(ModelAWidgetContribution).toSelf().inSingletonScope();
  bind(WidgetOpenHandler).toService(ModelAWidgetContribution);
  bind(CommandContribution).toService(ModelAWidgetContribution);
  bind(KeybindingContribution).toService(ModelAWidgetContribution);
  bind(MenuContribution).toService(ModelAWidgetContribution);

  bind(ModelAWidget).toSelf();
  bind(WidgetFactory)
    .toDynamicValue(({ container }) => ({
      id: ModelAWidget.ID,
      createWidget: (options: ModelFormWidgetOptions) => {
        const child = container.createChild();
        child.bind(ModelFormWidgetOptions).toConstantValue(options);
        return child.get(ModelAWidget);
      },
    }))
    .inSingletonScope();
}

export default new ContainerModule((bind) => {
  bindModelAWidget(bind);
});
