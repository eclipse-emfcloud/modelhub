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

import { ModelAccessorBus } from '@eclipse-emfcloud/model-accessor-bus';
import {
  CommandStack,
  ModelManager,
  SimpleCommand,
  createModelUpdaterCommand,
} from '@eclipse-emfcloud/model-manager';
import {
  AbstractModelServiceContribution,
  HubAwareProvider,
  ModelHub,
  ModelServiceContribution,
} from '@eclipse-emfcloud/model-service';
import { Container } from '@theia/core/shared/inversify';
import { expect } from 'chai';
import { Operation } from 'fast-json-patch';
import sinon from 'sinon';
import {
  ModelAccessorBusClient,
  ModelAccessorBusProtocolServicePath,
} from '../../common';
import backendModule from '../backend-module';
import { ModelAccessorBusServer } from '../model-accessor-bus-server';
import { ModelHubProvider } from '../model-hub-provider';
import { ModelServiceContribution as ModelServiceContributionIdentifier } from '../model-service-contribution';
import {
  RpcConnectionFactory,
  bindFakeRpcConnectionFactory,
} from './fake-json-rpc';

type FakeModel = Record<string, unknown>;
const FAKE_MODEL_ID = 'test.fake-model';

function createTestContainer(contrib: ModelServiceContribution): Container {
  const container = new Container();

  container.load(backendModule);
  container.bind(ModelServiceContributionIdentifier).toConstantValue(contrib);
  bindFakeRpcConnectionFactory(container);

  return container;
}
type FullModelAccessorBusServer = ModelAccessorBusServer<string> & {
  getModelAccessorBus: (context: string) => Promise<ModelAccessorBus>;
};
describe('Model Accessor Bus Server', () => {
  const appContext = 'test-app';

  let sandbox: sinon.SinonSandbox;
  let modelAccessorBusServer: ModelAccessorBusServer;
  let fakeContribution: FakeContribution;
  let clientProxy: {
    [key in keyof ModelAccessorBusClient]: sinon.SinonSpy<
      Parameters<ModelAccessorBusClient[key]>
    >;
  };

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    fakeContribution = new FakeContribution();
    const container = createTestContainer(fakeContribution);
    const factory = container.get(RpcConnectionFactory);
    clientProxy = {
      onAccessorChanged: sandbox.stub(),
      closeSubscription: sandbox.stub(),
    };
    modelAccessorBusServer = await factory.getServer<ModelAccessorBusServer>(
      ModelAccessorBusProtocolServicePath,
      clientProxy
    );

    // Some tests need to start interacting with the model service
    // right away, so initialize the context's provided hub
    await container.get<ModelHubProvider>(ModelHubProvider)(appContext);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('getClient', async () => {
    beforeEach(() => {
      sandbox = sinon.createSandbox();
    });
    afterEach(() => {
      sandbox.restore();
    });

    it('expect not undefined', async () => {
      expect(modelAccessorBusServer.getClient()).not.to.be.undefined;
    });

    it('expect undefined', async () => {
      modelAccessorBusServer.setClient(undefined);
      expect(modelAccessorBusServer.getClient()).to.be.undefined;
    });

    it('expect specific client', async () => {
      const alternateProxy: ModelAccessorBusClient = {
        onAccessorChanged: sandbox.stub(),
        closeSubscription: sandbox.stub(),
      };
      modelAccessorBusServer.setClient(alternateProxy);
      expect(modelAccessorBusServer.getClient()).to.be.equal(alternateProxy);
    });
  });

  describe('setClient', async () => {
    beforeEach(() => {
      sandbox = sinon.createSandbox();
    });
    afterEach(() => {
      sandbox.restore();
    });

    it('expect undefined', async () => {
      modelAccessorBusServer.setClient(undefined);
      expect(modelAccessorBusServer.getClient()).to.be.undefined;
    });

    it('expect same client', async () => {
      modelAccessorBusServer.setClient(clientProxy);
      expect(modelAccessorBusServer.getClient()).to.be.equal(clientProxy);
    });

    it('expect client change with disposeSubscriptions', async () => {
      const alternateProxy: ModelAccessorBusClient = {
        onAccessorChanged: sandbox.stub(),
        closeSubscription: sandbox.stub(),
      };
      expect(
        await modelAccessorBusServer.subscribe(appContext, 'test')
      ).to.be.eql(
        {
          id: 1,
          accessorId: 'test',
        },
        'Subscribe did not provide the expected result.'
      );
      modelAccessorBusServer.setClient(alternateProxy);
      expect(modelAccessorBusServer.getClient()).to.be.equal(
        alternateProxy,
        'Client does not match expected result'
      );
    });
  });

  describe('subscribe', async () => {
    beforeEach(() => {
      sandbox = sinon.createSandbox();
    });
    afterEach(() => {
      sandbox.restore();
    });

    it('no client', async () => {
      modelAccessorBusServer.setClient(undefined);
      expect(
        await modelAccessorBusServer.subscribe(appContext, 'test')
      ).to.be.eql({
        id: 1,
        accessorId: 'test',
      });
    });

    it('expect subscription token', async () => {
      expect(
        await modelAccessorBusServer.subscribe(appContext, 'test')
      ).to.be.eql({
        id: 1,
        accessorId: 'test',
      });
    });

    it('expect 2 different subscription token', async () => {
      expect(
        await modelAccessorBusServer.subscribe(appContext, 'test1')
      ).to.be.eql({
        id: 1,
        accessorId: 'test1',
      });
      expect(
        await modelAccessorBusServer.subscribe(appContext, 'test2')
      ).to.be.eql({
        id: 2,
        accessorId: 'test2',
      });
    });
  });

  describe('closeSubscription', async () => {
    beforeEach(() => {
      sandbox = sinon.createSandbox();
    });
    afterEach(() => {
      sandbox.restore();
    });

    it('execute closeSubscription with no subscription', async () => {
      expect(() =>
        modelAccessorBusServer.closeSubscription({
          id: 1,
          accessorId: 'test',
        })
      ).not.to.throw();
    });

    it('execute closeSubscription', async () => {
      const token = await modelAccessorBusServer.subscribe(appContext, 'test');
      expect(token).to.be.eql(
        {
          id: 1,
          accessorId: 'test',
        },
        'Subscribe did not provide the expected result.'
      );
      expect(() =>
        modelAccessorBusServer.closeSubscription(token)
      ).not.to.throw();
    });

    it('execute dispose', async () => {
      const token = await modelAccessorBusServer.subscribe(appContext, 'test');
      expect(token).to.be.eql(
        {
          id: 1,
          accessorId: 'test',
        },
        'Subscribe did not provide the expected result.'
      );
      modelAccessorBusServer.dispose();
    });
  });

  describe('get', async () => {
    it('expect undefined : existing context, not existing accessor', async () => {
      expect(await modelAccessorBusServer.get(appContext, 'empty')).to.be
        .undefined;
    });
  });

  describe('trigger subscription', () => {
    it('expect subscription token', async () => {
      const providerChangeSubToken = await modelAccessorBusServer.subscribe(
        appContext,
        'fake-provider.get'
      );
      const fakeService = fakeContribution.getModelService<FakeModelService>();

      expect(providerChangeSubToken).to.be.eql(
        {
          id: 1,
          accessorId: 'fake-provider.get',
        },
        'Subscription did not provide the expected result.'
      );

      await fakeService.setName('Fake Model 2');

      expect(clientProxy.onAccessorChanged.calledOnceWith(1)).to.be.true;
    });
  });
  describe('getModelAccessorBus', async () => {
    it('expect to be different on different contexts', async () => {
      const spiedAccessorBusAccess = sandbox.spy(
        modelAccessorBusServer as FullModelAccessorBusServer
      );
      await Promise.all([
        modelAccessorBusServer.get(appContext, 'empty'),
        modelAccessorBusServer.get(`${appContext}-2`, 'empty'),
      ]);
      expect(spiedAccessorBusAccess.getModelAccessorBus.calledTwice).to.be.true;
      const bus_0 = await spiedAccessorBusAccess.getModelAccessorBus
        .returnValues[0];
      const bus_1 = await spiedAccessorBusAccess.getModelAccessorBus
        .returnValues[1];
      expect(bus_0 !== bus_1).to.be.true;
    });
    it('expect to be same for same contexts', async () => {
      const spiedAccessorBusAccess = sandbox.spy(
        modelAccessorBusServer as FullModelAccessorBusServer
      );
      await Promise.all([
        modelAccessorBusServer.get(appContext, 'empty'),
        modelAccessorBusServer.get(appContext, 'empty'),
      ]);
      expect(spiedAccessorBusAccess.getModelAccessorBus.calledTwice).to.be.true;
      const bus_0 = await spiedAccessorBusAccess.getModelAccessorBus
        .returnValues[0];
      const bus_1 = await spiedAccessorBusAccess.getModelAccessorBus
        .returnValues[1];
      expect(bus_0 === bus_1).to.be.true;
    });
  });
});

export class MockProvider extends HubAwareProvider {
  constructor() {
    super('fake-provider');
    this.getId = this.getId.bind(this);
    this.accessors.set('get', this.getId);
  }

  setModelHub(modelHub: ModelHub<string, object>): void {
    super.setModelHub(modelHub);
    const subscription = modelHub.subscribe(FAKE_MODEL_ID);
    subscription.onModelChanged = (
      _modelId: string,
      _model: object,
      delta?: Operation[]
    ) => {
      if (delta?.some((op) => op.path === '/name')) {
        this.notify('get');
      }
    };
  }

  getId() {
    return this.id;
  }
}

const mockProvider = new MockProvider();

interface FakeModelService {
  getModel(): FakeModel;
  setName(newName: string): Promise<void>;
}

class FakeContribution extends AbstractModelServiceContribution<string> {
  protected commandStack: CommandStack;
  protected readonly model: FakeModel = {
    name: 'Fake Model 1',
  };

  protected readonly modelService: FakeModelService = {
    getModel: () => {
      let model = this.modelManager.getModel<FakeModel>(FAKE_MODEL_ID);
      if (!model) {
        this.modelManager.setModel(FAKE_MODEL_ID, this.model);
        model = this.modelManager.getModel<FakeModel>(FAKE_MODEL_ID);
      }
      if (!model) {
        throw new Error('No model to edit');
      }
      return model;
    },
    setName: async (newName) => {
      this.modelService.getModel(); // Ensure the model is loaded
      const command = createSetNameCommand(FAKE_MODEL_ID, newName);
      await this.commandStack.execute(command);
    },
  };

  getModelService<S>(): S {
    return this.modelService as S;
  }

  setModelManager(modelManager: ModelManager<string>): void {
    super.setModelManager(modelManager);
    this.commandStack = modelManager.getCommandStack(FAKE_MODEL_ID);
  }
  constructor() {
    super();

    this.initialize({
      id: 'test.contrib1',
      persistenceContribution: {
        canHandle: (modelId) => Promise.resolve(modelId === FAKE_MODEL_ID),
        loadModel: (modelId) =>
          modelId === FAKE_MODEL_ID
            ? Promise.resolve(this.model)
            : Promise.reject(new Error(`No such model: ${modelId}`)),
        saveModel: async (modelId, model) => {
          if (modelId !== FAKE_MODEL_ID) {
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
      modelAccessorContribution: {
        getProviders() {
          return [mockProvider];
        },
      },
    });
  }
}

function createSetNameCommand(
  modelId: string,
  newName: string
): SimpleCommand<string> {
  return createModelUpdaterCommand<string, FakeModel>(
    'Set Name',
    modelId,
    (model) => {
      model.name = newName;
    }
  );
}
