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
  ModelA,
} from '@eclipse-emfcloud-example/model-a-api';
import {
  MODEL_B_API,
  MODEL_B_MODEL_ID,
  ModelBModelService,
} from '@eclipse-emfcloud-example/model-b-api';
import { ChangeSubscription } from '@eclipse-emfcloud/model-manager';
import {
  AbstractModelServiceContribution,
  ModelHub,
} from '@eclipse-emfcloud/model-service';
import { Deferred } from '@theia/core/lib/common/promise-util';
import {
  inject,
  injectable,
  postConstruct,
} from '@theia/core/shared/inversify';
import { WorkspaceServer } from '@theia/workspace/lib/common';
import { ModelAInternalAPI } from '../common';
import { ModelAModelServiceImpl } from './model-a-model-service-impl';
import {
  createModelAccessorContribution,
  createPersistenceContribution,
  createTriggerContribution,
} from './model-service-contribution';

@injectable()
export class ModelAModelServiceContribution extends AbstractModelServiceContribution<string> {
  @inject(ModelAInternalAPI)
  private internalAPI: ModelAInternalAPI;

  @inject(WorkspaceServer)
  private workspaceServer: WorkspaceServer;

  private readonly modelService = new ModelAModelServiceImpl();

  private readonly modelAURI = new Deferred<string>();

  private modelASubscriber?: ChangeSubscription<string, ModelA>;

  constructor() {
    super();
    console.log('ModelAModelServiceContribution');
  }

  @postConstruct()
  protected init(): void {
    this.initialize({
      id: MODEL_A_API,
      persistenceContribution: createPersistenceContribution(
        this.workspaceServer
      ),
      triggerContribution: createTriggerContribution(),
      modelAccessorContribution: createModelAccessorContribution(
        () => this.modelAURI.promise
      ),
    });
  }

  dispose(): void {
    const context = this.modelHub.context;
    if (typeof context === 'string') {
      this.internalAPI.removeModelManager(context, this.modelManager);
    }

    this.modelASubscriber?.close();
  }

  getModelService<S>(): S {
    return this.modelService as S;
  }

  setModelHub(modelHub: ModelHub<string, string>): void {
    super.setModelHub(modelHub);
    this.modelService.setModelHub(modelHub);
    this.internalAPI.addModelManager(modelHub.context, this.modelManager);
    this.initializeModelSubscriptions(modelHub.context);
  }
  async initializeModelSubscriptions(project: string): Promise<void> {
    const modelUriPrefix = `${project}/${project.substring(
      project.lastIndexOf('/') + 1
    )}`;
    const modelA = `${modelUriPrefix}.${MODEL_A_MODEL_ID}`;
    const modelB = `${modelUriPrefix}.${MODEL_B_MODEL_ID}`;
    this.modelAURI.resolve(modelA);
    this.modelASubscriber = this.modelHub.subscribe(modelA);
    this.modelASubscriber.onModelChanged = async (_modelId, modelA) => {
      const name = `${modelA.firstName} ${modelA.lastName}`;
      const modelServiceB =
        this.modelHub.getModelService<ModelBModelService>(MODEL_B_API);
      if (modelServiceB) {
        // Different command-stack ID because it should not be part of the "undo" stack
        const setName = await modelServiceB?.createSetNameCommand(modelB, name);
        const stack = this.modelManager.getCommandStack('ModelBSync');
        if (setName && stack && (await stack.canExecute(setName))) {
          stack.execute(setName);
        }
      }
    };
  }
}
