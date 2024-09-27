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

import { ModelChangedCallback } from '@eclipse-emfcloud/model-manager';
import {
  ModelDirtyStateChangedCallback,
  ModelHubDisposedCallback,
  ModelHubSubscription,
  ModelLoadedCallback,
  ModelServiceSubscription,
  ModelUnloadedCallback,
  ModelValidatedCallback,
} from '@eclipse-emfcloud/model-service';
import { Diagnostic, ok } from '@eclipse-emfcloud/model-validation';
import { Container } from '@theia/core/shared/inversify';
import { expect } from 'chai';
import { Operation } from 'fast-json-patch';
import sinon from 'sinon';
import {
  FrontendModelHub,
  FrontendModelHubProvider,
} from '../frontend-model-hub';
import { FrontendModelHubSubscriber } from '../frontend-model-hub-subscriber';
import { FakeModelHubProtocol, connectClient } from './fake-model-hub-protocol';
import { testModule } from './test-module';

function createTestContainer(): Container {
  const container = new Container();

  container.load(testModule);

  return container;
}

const MODEL1_ID = 'test.model1';
const MODEL1 = { name: 'Model 1' };

const MODEL2_ID = 'test.model2';
const MODEL2 = { name: 'Model 2' };

type MethodKeysOf<T> = {
  [K in keyof T]: T[K] extends (...args: unknown[]) => unknown ? K : never;
}[keyof T];

describe('FrontendModelHub', () => {
  const appContext = 'test-app';

  let sandbox: sinon.SinonSandbox;
  let modelHub: FrontendModelHub;
  let fake: FakeModelHubProtocol;
  let provider: FrontendModelHubProvider;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    const container = createTestContainer();
    provider = container.get<FrontendModelHubProvider>(
      FrontendModelHubProvider
    );
    modelHub = await provider(appContext);
    const subscriber = container.get<FrontendModelHubSubscriber>(
      FrontendModelHubSubscriber
    );

    fake = container.get(FakeModelHubProtocol);
    fake.setModel(MODEL1_ID, MODEL1);
    connectClient(fake, subscriber);
  });

  describe('simple delegators', () => {
    it('getModel', async () => {
      const model = await modelHub.getModel(MODEL1_ID);
      expect(model).to.be.like(MODEL1);
    });
    const delegators: MethodKeysOf<FrontendModelHub>[] = [
      'validateModels',
      'getValidationState',
      'save',
      'isDirty',
      'undo',
      'redo',
      'flush',
    ];
    const error: Diagnostic = {
      message: 'A test error.',
      path: '/name',
      severity: 'error',
      source: 'test',
    };
    const results = [error, error, true, true, true, true, true];

    delegators.forEach((methodName, index) => {
      it(methodName, async () => {
        const stub = sandbox.stub().resolves(results[index]);
        const template: Record<string, unknown> = {};
        template[methodName] = stub;
        Object.assign(fake, template);
        const result = await modelHub[methodName](MODEL1_ID);
        expect(result).to.eql(results[index]);
        sinon.assert.calledWithExactly(stub, appContext, MODEL1_ID);
      });
    });
  });

  describe('subscriptions', () => {
    let onModelChanged: sinon.SinonStub<
      Parameters<ModelChangedCallback<string>>
    >;
    let onModelDirtyState: sinon.SinonStub<
      Parameters<ModelDirtyStateChangedCallback<string>>
    >;
    let onModelValidated: sinon.SinonStub<
      Parameters<ModelValidatedCallback<string>>
    >;
    let onModelLoaded: sinon.SinonStub<Parameters<ModelLoadedCallback>>;
    let onModelUnloaded: sinon.SinonStub<Parameters<ModelUnloadedCallback>>;
    let onModelHubDisposed: sinon.SinonStub<
      Parameters<ModelHubDisposedCallback>
    >;

    beforeEach(async () => {
      onModelChanged = sandbox.stub();
      onModelDirtyState = sandbox.stub();
      onModelLoaded = sandbox.stub();
      onModelUnloaded = sandbox.stub();
      onModelValidated = sandbox.stub();
      onModelHubDisposed = sandbox.stub();
    });

    it('notifies model change', async () => {
      const sub = await modelHub.subscribe(MODEL1_ID);
      sub.onModelChanged = onModelChanged;

      const patch: Operation[] = [
        { op: 'replace', path: '/name', value: MODEL1.name },
      ];
      fake.fakeModelChange(MODEL1_ID, patch);

      await asyncsResolved();

      sinon.assert.calledWithMatch(onModelChanged, MODEL1_ID, MODEL1, patch);
    });

    it('notifies dirty state', async () => {
      const sub = await modelHub.subscribe(MODEL1_ID);
      sub.onModelDirtyState = onModelDirtyState;

      fake.fakeModelDirtyState(MODEL1_ID, true);

      await asyncsResolved();

      sinon.assert.calledWithMatch(onModelDirtyState, MODEL1_ID, MODEL1, true);
    });

    it('notifies model validation', async () => {
      const sub = await modelHub.subscribe(MODEL1_ID);
      sub.onModelValidated = onModelValidated;

      const diagnostic: Diagnostic = {
        message: 'This is a test',
        path: '/name',
        severity: 'error',
        source: 'test',
      };
      fake.fakeModelValidated(MODEL1_ID, diagnostic);

      await asyncsResolved();

      sinon.assert.calledWithMatch(
        onModelValidated,
        MODEL1_ID,
        MODEL1,
        diagnostic
      );
    });

    it('notifies model loaded', async () => {
      const sub = await modelHub.subscribe(MODEL2_ID);
      sub.onModelLoaded = onModelLoaded;

      fake.setModel(MODEL2_ID, MODEL2);

      await asyncsResolved();

      sinon.assert.calledWithExactly(onModelLoaded, MODEL2_ID);
    });

    it('notifies model unloaded', async () => {
      await modelHub.getModel(MODEL1_ID);

      const sub = await modelHub.subscribe(MODEL1_ID);
      sub.onModelUnloaded = onModelUnloaded;

      fake.removeModel(MODEL1_ID);

      await asyncsResolved();

      sinon.assert.calledWithMatch(onModelUnloaded, MODEL1_ID, MODEL1);
    });

    it('notifies hub disposal', async () => {
      const sub: ModelHubSubscription<string> = await modelHub.subscribe();
      sub.onModelHubDisposed = onModelHubDisposed;

      fake.fakeModelHubDisposed();

      await asyncsResolved();

      sinon.assert.called(onModelHubDisposed);
      expect(modelHub.isDisposed).to.be.true;
    });

    describe('closes subscriptions', () => {
      const patch: Operation[] = [
        { op: 'replace', path: '/name', value: MODEL1.name },
      ];
      let sub: ModelServiceSubscription;

      beforeEach(async () => {
        sub = await modelHub.subscribe(MODEL1_ID);
        sub.onModelChanged = onModelChanged;

        fake.fakeModelChange(MODEL1_ID, patch);

        return asyncsResolved();
      });

      it('from the frontend', async () => {
        sub.close();

        await asyncsResolved();

        fake.fakeModelChange(MODEL1_ID, patch);

        await asyncsResolved();

        expect(onModelChanged.callCount).to.be.equal(1);
      });

      it('from the backend', async () => {
        fake.fakeSubscriptionClosed(MODEL1_ID);

        await asyncsResolved();

        fake.fakeModelChange(MODEL1_ID, patch);

        await asyncsResolved();

        expect(onModelChanged.callCount).to.be.equal(1);
      });
    });

    it("doesn't blow up on unassigned call-back", async () => {
      await modelHub.subscribe(MODEL1_ID);

      fake.fakeModelChange(MODEL1_ID, []);
      fake.fakeModelDirtyState(MODEL1_ID, true);
      fake.fakeModelValidated(MODEL1_ID, ok());

      await asyncsResolved();
    });
  });

  describe('error cases', () => {
    it('initialization failure', async () => {
      const errorStub = sandbox.stub(console, 'error');
      await provider('Boom!');

      await asyncsResolved();

      expect(errorStub).to.have.been.calledWithMatch(
        'Failed to initialize',
        'Bomb context'
      );
    });
  });
});

function asyncsResolved(): Promise<void> {
  // It only takes until the next tick because in the test fixture
  // the promises involved are all a priori resolved
  return new Promise((resolve) => {
    setImmediate(() => {
      resolve();
    });
  });
}
