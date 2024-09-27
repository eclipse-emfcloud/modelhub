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
  CommandStack,
  ModelManager,
  SimpleCommand,
  createModelUpdaterCommand,
} from '@eclipse-emfcloud/model-manager';
import {
  AbstractModelServiceContribution,
  ModelHub,
  ModelServiceContribution,
} from '@eclipse-emfcloud/model-service';
import { Diagnostic, ok } from '@eclipse-emfcloud/model-validation';
import { Container } from '@theia/core/shared/inversify';
import chai, { expect } from 'chai';
import chaiLike from 'chai-like';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import {
  ModelHubClient,
  ModelHubProtocolServicePath,
  ModelServiceSubscriptionToken,
} from '../../common';
import backendModule from '../backend-module';
import { ModelHubProvider } from '../model-hub-provider';
import { ModelHubServer } from '../model-hub-server';
import { ModelServiceContribution as ModelServiceContributionIdentifier } from '../model-service-contribution';
import {
  RpcConnectionFactory,
  bindFakeRpcConnectionFactory,
} from './fake-json-rpc';

chai.use(chaiLike);
chai.use(sinonChai);

type Model = Record<string, unknown>;

const MODEL1_ID = 'test.model1';

function createTestContainer(
  ...contributions: ModelServiceContribution[]
): Container {
  const container = new Container();

  container.load(backendModule);
  contributions.forEach((contrib) =>
    container.bind(ModelServiceContributionIdentifier).toConstantValue(contrib)
  );
  bindFakeRpcConnectionFactory(container);

  return container;
}

describe('ModelHubServer', () => {
  const appContext = 'test-app';

  let sandbox: sinon.SinonSandbox;
  let contrib1: Contribution1;
  let modelHubServer: ModelHubServer;
  let clientProxy: {
    [key in keyof ModelHubClient]: sinon.SinonSpy<
      Parameters<ModelHubClient[key]>
    >;
  };
  let modelHub: ModelHub;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    contrib1 = new Contribution1();
    const container = createTestContainer(contrib1);
    const factory = container.get(RpcConnectionFactory);
    clientProxy = {
      onModelChanged: sandbox.stub(),
      onModelDirtyState: sandbox.stub(),
      onModelValidated: sandbox.stub(),
      onModelLoaded: sandbox.stub(),
      onModelUnloaded: sandbox.stub(),
      onModelHubDisposed: sandbox.stub(),
      closeSubscription: sandbox.stub(),
      onModelHubCreated: sandbox.stub(),
      onModelHubDestroyed: sandbox.stub(),
    };
    modelHubServer = await factory.getServer<ModelHubServer>(
      ModelHubProtocolServicePath,
      clientProxy
    );

    // Some tests need to start interacting with the model service
    // right away, so initialize the context's provided hub
    modelHub = await container.get<ModelHubProvider>(ModelHubProvider)(
      appContext
    );
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('provides a model', async () => {
    const model: Model = await modelHubServer.getModel(appContext, MODEL1_ID);
    expect(model).to.be.like({ name: 'Model 1' });
  });

  it('validates a model', async () => {
    const model: Model = await modelHubServer.getModel(appContext, MODEL1_ID);
    model.name = 'NoSpace';

    let diagnostic: Diagnostic | undefined;

    diagnostic = await modelHubServer.validateModels(appContext, MODEL1_ID);
    expect(diagnostic).to.be.like({ severity: 'error', path: '/name' });

    model.name = 'Has Space';

    // Haven't revalidated, yet
    diagnostic = await modelHubServer.getValidationState(appContext, MODEL1_ID);
    expect(diagnostic).to.be.like({ severity: 'error', path: '/name' });

    diagnostic = await modelHubServer.validateModels(appContext, MODEL1_ID);
    expect(diagnostic).to.be.eql(ok());
  });

  it('can undo and redo', async () => {
    const service = contrib1.getModelService<ModelService1>();

    expect(service).to.exist;
    await service?.setName('New Name');

    let model = await modelHubServer.getModel(appContext, MODEL1_ID);
    expect(model).to.be.like({ name: 'New Name' });

    const undone = await modelHubServer.undo(appContext, MODEL1_ID);
    expect(undone).to.be.true;
    model = await modelHubServer.getModel(appContext, MODEL1_ID);
    expect(model).to.be.like({ name: 'Model 1' });

    const redone = await modelHubServer.redo(appContext, MODEL1_ID);
    expect(redone).to.be.true;
    model = await modelHubServer.getModel(appContext, MODEL1_ID);
    expect(model).to.be.like({ name: 'New Name' });
  });

  it('manages dirty state', async () => {
    let dirty = await modelHubServer.isDirty(appContext, MODEL1_ID);
    expect(dirty).to.be.false;

    const service = contrib1.getModelService<ModelService1>();

    expect(service).to.exist;
    await service?.setName('New Name');

    dirty = await modelHubServer.isDirty(appContext, MODEL1_ID);
    expect(dirty).to.be.true;

    await modelHubServer.undo(appContext, MODEL1_ID);
    dirty = await modelHubServer.isDirty(appContext, MODEL1_ID);
    expect(dirty).to.be.false;

    await modelHubServer.redo(appContext, MODEL1_ID);
    dirty = await modelHubServer.isDirty(appContext, MODEL1_ID);
    expect(dirty).to.be.true;

    const saved = await modelHubServer.save(appContext, MODEL1_ID);
    expect(saved).to.be.true;

    dirty = await modelHubServer.isDirty(appContext, MODEL1_ID);
    expect(dirty).to.be.false;

    await modelHubServer.undo(appContext, MODEL1_ID);
    dirty = await modelHubServer.isDirty(appContext, MODEL1_ID);
    expect(dirty).to.be.true;

    const flushed = await modelHubServer.flush(appContext, MODEL1_ID);
    expect(flushed).to.be.true;
    dirty = await modelHubServer.isDirty(appContext, MODEL1_ID);
    expect(dirty).to.be.true;

    // Cannot redo after flush
    const redone = await modelHubServer.redo(appContext, MODEL1_ID);
    expect(redone).to.be.false;
  });

  describe('manages subscriptions', async () => {
    let token: ModelServiceSubscriptionToken;

    beforeEach(async () => {
      token = await modelHubServer.subscribe(appContext, MODEL1_ID);
      const service = contrib1.getModelService<ModelService1>();

      expect(service).to.exist;
      await service?.setName('NewName');
    });

    it('creates the subscription', () => {
      expect(token).to.exist;
      expect(token.id).to.be.greaterThan(0);
      expect(token.modelIds).to.be.eql([MODEL1_ID]);
    });

    it('notifies model changed', () => {
      sinon.assert.calledOnceWithMatch(
        clientProxy.onModelChanged,
        token.id,
        MODEL1_ID,
        [
          { op: 'test', path: '/name', value: 'Model 1' },
          { op: 'replace', path: '/name', value: 'NewName' },
        ]
      );
    });

    it('notifies model validation', async () => {
      await modelHubServer.validateModels(appContext, MODEL1_ID);

      // It was already called once with an OK result on creation of the model
      sinon.assert.calledWithMatch(
        clientProxy.onModelValidated,
        token.id,
        MODEL1_ID,
        sinon.match({
          severity: 'error',
          path: '/name',
        }) as unknown as Diagnostic
      );
    });

    it('notifies dirty state', async () => {
      sinon.assert.calledWithMatch(
        clientProxy.onModelDirtyState,
        token.id,
        MODEL1_ID,
        true
      );

      await modelHubServer.save(appContext, MODEL1_ID);

      sinon.assert.calledWithMatch(
        clientProxy.onModelDirtyState,
        token.id,
        MODEL1_ID,
        false
      );
    });

    it('notifies model loaded', async () => {
      sinon.assert.calledWithMatch(
        clientProxy.onModelLoaded,
        token.id,
        MODEL1_ID
      );
    });

    it('notifies model unloaded', async () => {
      const modelManager = (
        modelHub as unknown as { modelManager: ModelManager<string> }
      ).modelManager;
      modelManager.removeModel(MODEL1_ID);

      sinon.assert.calledWithMatch(
        clientProxy.onModelUnloaded,
        token.id,
        MODEL1_ID
      );
    });

    it('notifies hub disposal', () => {
      modelHub.dispose();

      sinon.assert.calledWithMatch(clientProxy.onModelHubDisposed, token.id);
    });

    it('can be closed', async () => {
      await modelHubServer.closeSubscription(token);

      sinon.assert.calledWithExactly(clientProxy.closeSubscription, token.id);

      // Second attempt is harmless and without effect
      await modelHubServer.closeSubscription(token);

      expect(clientProxy.closeSubscription.callCount).to.be.equal(1);
    });
  });

  describe('disposal scenarios', () => {
    // The main state to clean up is the subscriptions
    let token: ModelServiceSubscriptionToken;

    beforeEach(async () => {
      token = await modelHubServer.subscribe(appContext, MODEL1_ID);
    });

    it('dispose the server', () => {
      modelHubServer.dispose();
      sinon.assert.calledWithExactly(clientProxy.closeSubscription, token.id);
    });

    it('delete the client', async () => {
      modelHubServer.setClient(undefined);
      expect(modelHubServer.getClient()).not.to.exist;
      sinon.assert.calledWithExactly(clientProxy.closeSubscription, token.id);

      // After this point, subscriptions don't do anything
      const newSub = await modelHubServer.subscribe(appContext, MODEL1_ID);
      const service = contrib1.getModelService<ModelService1>();
      expect(service).to.exist;
      await service?.setName('New Name');
      sinon.assert.neverCalledWithMatch(
        clientProxy.onModelChanged,
        newSub.id,
        sinon.match.any,
        sinon.match.any
      );
    });

    it('setting the same client has no effect', () => {
      modelHubServer.setClient(clientProxy);
      sinon.assert.notCalled(clientProxy.closeSubscription);
    });
  });

  describe('model hub tracking', () => {
    it('notifies model hub creation', async () => {
      await modelHubServer.getModel(appContext, MODEL1_ID);
      expect(clientProxy.onModelHubCreated).to.have.been.calledWith(appContext);
    });

    it('notifies model hub creation', async () => {
      await modelHubServer.getModel(appContext, MODEL1_ID);
      modelHub.dispose();
      expect(clientProxy.onModelHubDestroyed).to.have.been.calledWith(
        appContext
      );
    });
  });
});

interface ModelService1 {
  getModel(): Model;
  setName(newName: string): Promise<void>;
}

class Contribution1 extends AbstractModelServiceContribution<string, Model> {
  protected commandStack: CommandStack;

  protected readonly modelService: ModelService1 = {
    getModel: () => {
      let model = this.modelManager.getModel<Model>(MODEL1_ID);
      if (!model) {
        this.modelManager.setModel(MODEL1_ID, this.model);
        model = this.modelManager.getModel<Model>(MODEL1_ID);
      }
      if (!model) {
        throw new Error('No model to edit');
      }
      return model;
    },
    setName: async (newName) => {
      this.modelService.getModel(); // Ensure the model is loaded
      const command = createSetNameCommand(MODEL1_ID, newName);
      await this.commandStack.execute(command);
    },
  };

  protected readonly model: Model = {
    name: 'Model 1',
  };

  constructor() {
    super();

    this.initialize({
      id: 'test.contrib1',
      persistenceContribution: {
        canHandle: (modelId) => Promise.resolve(modelId === MODEL1_ID),
        loadModel: (modelId) =>
          modelId === MODEL1_ID
            ? Promise.resolve(this.model)
            : Promise.reject(new Error(`No such model: ${modelId}`)),
        saveModel: async (modelId, model) => {
          if (modelId !== MODEL1_ID) {
            throw new Error(`Unsupported model ${modelId}`);
          }

          const newImage = { ...model };

          Array.from(Object.keys(this.model)).forEach(
            (key) => delete this.model[key]
          );

          Object.assign(this.model, newImage);

          return true;
        },
      },
      validationContribution: {
        getValidators: () => [
          {
            validate: async (_modelId, model) => {
              if (typeof model.name !== 'string') {
                return errorDiagnostic('No name.', '/name');
              }
              if (!model.name.includes(' ')) {
                return errorDiagnostic('No space in the name.', '/name');
              }
              return ok();
            },
          },
        ],
      },
    });
  }

  getModelService<S = unknown>(): S {
    return this.modelService as S;
  }

  setModelManager(modelManager: ModelManager<string>): void {
    super.setModelManager(modelManager);
    this.commandStack = modelManager.getCommandStack(MODEL1_ID);
  }
}

function errorDiagnostic(message: string, path: string): Diagnostic {
  return {
    message,
    path,
    severity: 'error',
    source: 'test',
  };
}

function createSetNameCommand(
  modelId: string,
  newName: string
): SimpleCommand<string> {
  return createModelUpdaterCommand<string, Model>(
    'Set Name',
    modelId,
    (model) => {
      model.name = newName;
    }
  );
}
