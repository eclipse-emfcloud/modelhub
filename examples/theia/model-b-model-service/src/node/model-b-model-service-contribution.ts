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
  MODEL_A_API,
  MODEL_A_MODEL_ID,
  ModelAModelService,
} from '@eclipse-emfcloud-example/model-a-api';
import {
  MODEL_B_API,
  MODEL_B_MODEL_ID,
  ModelB,
} from '@eclipse-emfcloud-example/model-b-api';
import { ChangeSubscription } from '@eclipse-emfcloud/model-manager';
import {
  AbstractModelServiceContribution,
  ModelHub,
} from '@eclipse-emfcloud/model-service';
import {
  inject,
  injectable,
  postConstruct,
} from '@theia/core/shared/inversify';
import { WorkspaceServer } from '@theia/workspace/lib/common';
import { ModelBInternalAPI } from '../common';
import { ModelBModelServiceImpl } from './model-b-model-service-impl';
import {
  createPersistenceContribution,
  createTriggerContribution,
  createValidationContribution,
} from './model-service-contribution';

@injectable()
export class ModelBModelServiceContribution extends AbstractModelServiceContribution<string> {
  @inject(ModelBInternalAPI)
  private internalAPI: ModelBInternalAPI;

  @inject(WorkspaceServer)
  private workspaceServer: WorkspaceServer;

  private readonly modelService = new ModelBModelServiceImpl();

  private modelBSubscriber?: ChangeSubscription<string, ModelB>;

  @postConstruct()
  protected init(): void {
    this.initialize({
      id: MODEL_B_API,
      persistenceContribution: createPersistenceContribution(
        this.workspaceServer
      ),
      validationContribution: createValidationContribution(),
      triggerContribution: createTriggerContribution(),
    });
  }

  dispose(): void {
    const context = this.modelHub.context;
    if (typeof context === 'string') {
      this.internalAPI.removeModelManager(context, this.modelManager);
    }
  }

  getModelService<S>(): S {
    return this.modelService as S;
  }

  setModelHub(modelHub: ModelHub<string, string>): void {
    super.setModelHub(modelHub);
    this.modelService.setModelHub(modelHub);
    this.internalAPI.addModelManager(modelHub.context, this.modelManager);
    this.initializeBusSubscriptions(modelHub.context);
    this.initializeModelSubscriptions(modelHub.context);
  }

  initializeBusSubscriptions(project: string) {
    const modelUriPrefix = `${project}/${project.substring(
      project.lastIndexOf('/') + 1
    )}`;
    const modelB = `${modelUriPrefix}.${MODEL_B_MODEL_ID}`;
    this.modelHub.getModelAccessorBus().subscribe('parity.sum', async () => {
      const isSumEven = await this.modelHub
        .getModelAccessorBus()
        .get<Promise<boolean>>('parity.sum');
      const model = await this.modelHub.getModel<ModelB>(modelB);
      if (model && model.evenSum !== isSumEven) {
        // Different command-stack ID because it should not be part of the "undo" stack
        this.internalAPI.updateModel(modelB, 'ModelBSync', {
          type: 'set',
          key: 'evenSum',
          value: isSumEven,
        });
      }
    });
  }

  async initializeModelSubscriptions(project: string): Promise<void> {
    const modelUriPrefix = `${project}/${project.substring(
      project.lastIndexOf('/') + 1
    )}`;
    const modelA = `${modelUriPrefix}.${MODEL_A_MODEL_ID}`;
    const modelB = `${modelUriPrefix}.${MODEL_B_MODEL_ID}`;

    this.modelBSubscriber = this.modelHub.subscribe(modelB);
    this.modelBSubscriber.onModelChanged = async (_modelId, modelB) => {
      // sanity check
      const number1 = typeof modelB.number1 === 'number' ? modelB.number1 : 0;
      const number2 = typeof modelB.number2 === 'number' ? modelB.number2 : 0;
      const sum = number1 + number2;
      const modelServiceA =
        this.modelHub.getModelService<ModelAModelService>(MODEL_A_API);
      if (modelServiceA) {
        // Different command-stack ID because it should not be part of the "undo" stack
        const setSum = await modelServiceA?.createSetSumCommand(modelA, sum);
        const stack = this.modelManager.getCommandStack('ModelASync');
        if (setSum && stack && (await stack.canExecute(setSum))) {
          stack.execute(setSum);
        }
      }
    };
  }
}
