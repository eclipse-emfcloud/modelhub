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
  FrontendApplicationContribution,
  KeybindingContribution,
  WidgetFactory,
  WidgetOpenHandler,
} from '@theia/core/lib/browser';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { ContainerModule, interfaces } from '@theia/core/shared/inversify';
import { DiagnosticManager } from './diagnostic-manager';
import { ModelBWidget } from './model-b-widget';
import { ModelBWidgetContribution } from './model-b-widget-contribution';

function bindModelBWidget(bind: interfaces.Bind): void {
  bind(ModelBWidgetContribution).toSelf().inSingletonScope();
  bind(WidgetOpenHandler).toService(ModelBWidgetContribution);
  bind(CommandContribution).toService(ModelBWidgetContribution);
  bind(KeybindingContribution).toService(ModelBWidgetContribution);
  bind(MenuContribution).toService(ModelBWidgetContribution);

  bind(ModelBWidget).toSelf();
  bind(WidgetFactory)
    .toDynamicValue(({ container }) => ({
      id: ModelBWidget.ID,
      createWidget: (options: ModelFormWidgetOptions) => {
        const child = container.createChild();
        child.bind(ModelFormWidgetOptions).toConstantValue(options);
        return child.get(ModelBWidget);
      },
    }))
    .inSingletonScope();
}

export default new ContainerModule((bind) => {
  bind(DiagnosticManager).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(DiagnosticManager);

  bindModelBWidget(bind);
});
