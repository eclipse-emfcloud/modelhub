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
import { MODEL_B_MODEL_ID } from '@eclipse-emfcloud-example/model-b-api';
import { ModelFormWidgetContribution } from '@eclipse-emfcloud-example/model-hub-integration/lib/browser/model-form-widget-contribution';
import { LabelProvider } from '@theia/core/lib/browser';
import { Command, URI } from '@theia/core/lib/common';
import { inject, injectable } from '@theia/core/shared/inversify';
import '../../src/browser/style.css';
import { ModelBWidget } from './model-b-widget';

export const OpenModelBViewCommand: Command = {
  id: 'model-b-view:open',
  label: 'Open the Model B View',
};

@injectable()
export class ModelBWidgetContribution extends ModelFormWidgetContribution<ModelBWidget> {
  public readonly id = ModelBWidget.ID;

  protected readonly modelID = MODEL_B_MODEL_ID;
  protected readonly modelName = 'Model B';
  protected readonly openModelCommand = OpenModelBViewCommand;

  @inject(LabelProvider)
  private readonly labelProvider: LabelProvider;

  protected async getProjectName(
    projectResource: URI
  ): Promise<string | undefined> {
    return this.labelProvider.getName(projectResource);
  }
}
