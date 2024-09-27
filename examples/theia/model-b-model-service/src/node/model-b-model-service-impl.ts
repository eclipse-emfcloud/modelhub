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
  ModelB,
  ModelBModelService,
} from '@eclipse-emfcloud-example/model-b-api';
import {
  Command,
  createModelUpdaterCommand,
} from '@eclipse-emfcloud/model-manager';
import { ModelHub } from '@eclipse-emfcloud/model-service';

export class ModelBModelServiceImpl implements ModelBModelService {
  private modelHub: ModelHub<string, string>;

  async createSetNameCommand(
    modelURI: string,
    name: string
  ): Promise<Command<string> | undefined> {
    const modelB = await this.modelHub.getModel<ModelB>(modelURI);

    if (!modelB || modelB.name === name) {
      return undefined; // Nothing to update
    }

    return createModelUpdaterCommand<string, ModelB>(
      'Set name',
      modelURI,
      (workingCopy) => (workingCopy.name = name)
    );
  }

  setModelHub(modelHub: ModelHub<string, string>): void {
    this.modelHub = modelHub;
  }
}
