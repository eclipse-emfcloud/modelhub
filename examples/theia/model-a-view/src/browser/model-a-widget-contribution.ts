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
import { MODEL_A_MODEL_ID } from '@eclipse-emfcloud-example/model-a-api';
import { ModelFormWidgetContribution } from '@eclipse-emfcloud-example/model-hub-integration/lib/browser/model-form-widget-contribution';
import { LabelProvider } from '@theia/core/lib/browser';
import { Command, URI } from '@theia/core/lib/common';
import { inject, injectable } from '@theia/core/shared/inversify';
import '../../src/browser/style.css';
import { ModelAWidget } from './model-a-widget';

export const OpenModelAViewCommand: Command = {
  id: 'model-a-view:open',
  label: 'Open the Model A View',
};

@injectable()
export class ModelAWidgetContribution extends ModelFormWidgetContribution<ModelAWidget> {
  public readonly id = ModelAWidget.ID;

  protected readonly modelID = MODEL_A_MODEL_ID;
  protected readonly modelName = 'Model A';
  protected readonly openModelCommand = OpenModelAViewCommand;

  @inject(LabelProvider)
  private readonly labelProvider: LabelProvider;

  protected async getProjectName(
    projectResource: URI
  ): Promise<string | undefined> {
    return this.labelProvider.getName(projectResource);
  }
}
