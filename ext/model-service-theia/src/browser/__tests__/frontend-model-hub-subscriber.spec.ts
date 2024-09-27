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
  ModelLoadedCallback,
  ModelServiceSubscription,
  ModelUnloadedCallback,
  ModelValidatedCallback,
} from '@eclipse-emfcloud/model-service';
import { Diagnostic, ok } from '@eclipse-emfcloud/model-validation';
import { Container } from '@theia/core/shared/inversify';
import chai, { assert, expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { Operation } from 'fast-json-patch';
import cloneDeep from 'lodash/cloneDeep';
import sinon from 'sinon';
import { ModelHubProtocol } from '../../common';
import { ModelHubTracker } from '../../common/model-hub-tracker';
import {
  FrontendModelHubSubscriber,
  FrontendModelHubSubscriberImpl,
} from '../frontend-model-hub-subscriber';
import { FakeModelHubProtocol, connectClient } from './fake-model-hub-protocol';
import { testModule } from './test-module';

chai.use(chaiAsPromised);

function createTestContainer(): Container {
  const container = new Container();

  container.load(testModule);

  return container;
}

const MODEL1_ID = 'test.model1';
const MODEL1 = { name: 'Model 1' };

describe('FrontendModelHubSubscriber', () => {
  const appContext = 'test-app';

  let sandbox: sinon.SinonSandbox;
  let fake: FakeModelHubProtocol;
  let subscriber: FrontendModelHubSubscriber;
  let tracker: ModelHubTracker;

  let onModelChanged: sinon.SinonStub<Parameters<ModelChangedCallback<string>>>;
  let onModelDirtyState: sinon.SinonStub<
    Parameters<ModelDirtyStateChangedCallback<string>>
  >;
  let onModelValidated: sinon.SinonStub<
    Parameters<ModelValidatedCallback<string>>
  >;
  let onModelLoaded: sinon.SinonStub<Parameters<ModelLoadedCallback<string>>>;
  let onModelUnloaded: sinon.SinonStub<
    Parameters<ModelUnloadedCallback<string>>
  >;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    const container = createTestContainer();
    subscriber = container.get<FrontendModelHubSubscriber>(
      FrontendModelHubSubscriber
    );
    tracker = container.get<ModelHubTracker>(ModelHubTracker);

    fake = container.get(FakeModelHubProtocol);
    fake.setModel(MODEL1_ID, MODEL1);
    connectClient(fake, subscriber);

    onModelChanged = sandbox.stub();
    onModelDirtyState = sandbox.stub();
    onModelValidated = sandbox.stub();
    onModelLoaded = sandbox.stub();
    onModelUnloaded = sandbox.stub();
  });

  const modelChangeCases: [string, string[]][] = [
    ['specific sub', [MODEL1_ID]],
    ['universal sub', <string[]>[]],
  ];
  describe('notifies model change', () => {
    modelChangeCases.forEach(([title, modelIds]) => {
      it(title, async () => {
        const sub = await subscriber.subscribe(appContext, ...modelIds);
        sub.onModelChanged = onModelChanged;

        const patch: Operation[] = [
          { op: 'replace', path: '/name', value: MODEL1.name },
        ];
        fake.fakeModelChange(MODEL1_ID, patch);

        await asyncsResolved();

        sinon.assert.calledWithMatch(onModelChanged, MODEL1_ID, MODEL1, patch);
      });
    });
  });

  const dirtyStateCases: [string, string[]][] = [
    ['specific sub', [MODEL1_ID]],
    ['universal sub', <string[]>[]],
  ];
  describe('notifies dirty state', () => {
    dirtyStateCases.forEach(([title, modelIds]) => {
      it(title, async () => {
        const sub = await subscriber.subscribe(appContext, ...modelIds);
        sub.onModelDirtyState = onModelDirtyState;

        fake.fakeModelDirtyState(MODEL1_ID, true);

        await asyncsResolved();

        sinon.assert.calledWithMatch(
          onModelDirtyState,
          MODEL1_ID,
          MODEL1,
          true
        );
      });
    });
  });

  const validationCases: [string, string[]][] = [
    ['specific sub', [MODEL1_ID]],
    ['universal sub', <string[]>[]],
  ];
  describe('notifies model validation', () => {
    validationCases.forEach(([title, modelIds]) => {
      it(title, async () => {
        const sub = await subscriber.subscribe(appContext, ...modelIds);
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
    });
  });

  const modelLoadedCases: [string, string[]][] = [
    ['specific sub', [MODEL1_ID]],
    ['universal sub', <string[]>[]],
  ];
  describe('notifies model loaded', () => {
    modelLoadedCases.forEach(([title, modelIds]) => {
      it(title, async () => {
        const sub = await subscriber.subscribe(appContext, ...modelIds);
        sub.onModelLoaded = onModelLoaded;

        fake.fakeModelLoaded(MODEL1_ID);

        await asyncsResolved();

        sinon.assert.calledWithMatch(onModelLoaded, MODEL1_ID);
      });
    });
  });

  const modelUnloadedCases: [string, string[]][] = [
    ['specific sub', [MODEL1_ID]],
    ['universal sub', <string[]>[]],
  ];
  describe('notifies model unloaded', () => {
    modelUnloadedCases.forEach(([title, modelIds]) => {
      it(title, async () => {
        const sub = await subscriber.subscribe(appContext, ...modelIds);
        sub.onModelUnloaded = onModelUnloaded;

        fake.fakeModelUnloaded(MODEL1_ID);

        await asyncsResolved();

        sinon.assert.calledWithMatch(onModelUnloaded, MODEL1_ID, MODEL1);
      });
    });
  });

  describe('closes subscriptions', () => {
    const patch: Operation[] = [
      { op: 'replace', path: '/name', value: MODEL1.name },
    ];
    let sub: ModelServiceSubscription;

    beforeEach(async () => {
      sub = await subscriber.subscribe(appContext, MODEL1_ID);
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

    it('is idempotent', async () => {
      sub.close();

      try {
        sub.close();
        sub.close();
      } catch (error) {
        assert.fail('Should have been OK to close subscription again.');
      }

      await asyncsResolved();

      fake.fakeModelChange(MODEL1_ID, patch);

      await asyncsResolved();

      expect(onModelChanged.callCount).to.be.equal(1);
    });
  });

  describe('non-interference from other remote subscriptions', () => {
    it('notifies model change', async () => {
      const foreignSub = await fake.subscribe(appContext, MODEL1_ID);

      const sub = await subscriber.subscribe(appContext, MODEL1_ID);
      sub.onModelChanged = onModelChanged;

      let patch: Operation[] = [
        { op: 'replace', path: '/name', value: MODEL1.name },
      ];
      fake.fakeModelChange(MODEL1_ID, patch);

      await asyncsResolved();

      sinon.assert.calledWithMatch(onModelChanged, MODEL1_ID, MODEL1, patch);

      // This mustn't close the frontend-subscriber
      await fake.closeSubscription(foreignSub);

      patch = [{ op: 'replace', path: '/name', value: 'another name' }];
      fake.fakeModelChange(MODEL1_ID, patch);

      await asyncsResolved();

      sinon.assert.calledWithMatch(onModelChanged, MODEL1_ID, MODEL1, patch);
    });

    it('closing in the other order', async () => {
      const foreignSub = await fake.subscribe(appContext, MODEL1_ID);

      // Hack into the subscriber for its subscriptions
      const subscriptions = (
        subscriber as unknown as {
          subscriptions: Array<unknown>;
        }
      ).subscriptions;

      const sub = await subscriber.subscribe(appContext, MODEL1_ID);
      expect(subscriptions).to.include(sub);

      fake.closeSubscription(2); // This is the subscriber's self-subscription

      // Closing the self-sub cleans up because now there are no
      // notifications to forward
      expect(subscriptions).not.to.include(sub);

      // But this is harmless
      await fake.closeSubscription(foreignSub);

      expect(subscriptions).not.to.include(sub);
    });
  });

  describe('corner cases', () => {
    it("doesn't blow up on unassigned call-back", async () => {
      await subscriber.subscribe(appContext, MODEL1_ID);

      fake.fakeModelChange(MODEL1_ID, []);
      fake.fakeModelDirtyState(MODEL1_ID, true);
      fake.fakeModelValidated(MODEL1_ID, ok());
      fake.fakeModelLoaded(MODEL1_ID);
      fake.fakeModelUnloaded(MODEL1_ID);
      fake.fakeModelHubDisposed();

      await asyncsResolved();
    });

    it("doesn't blow up on subscription gone AWOL", async () => {
      await subscriber.subscribe(appContext, MODEL1_ID);
      await asyncsResolved();

      // Hack out the subscription
      (
        subscriber as unknown as {
          subscriptions: Array<unknown>;
        }
      ).subscriptions.length = 0;

      fake.fakeModelChange(MODEL1_ID, []);
      fake.fakeModelDirtyState(MODEL1_ID, true);
      fake.fakeModelValidated(MODEL1_ID, ok());
      fake.fakeModelLoaded(MODEL1_ID);
      fake.fakeModelUnloaded(MODEL1_ID);
      fake.fakeModelHubDisposed();

      await asyncsResolved();
    });

    it("doesn't blow up on subscription pipeline gone AWOL", async () => {
      await subscriber.subscribe(appContext, MODEL1_ID);
      await asyncsResolved();

      // Hack out the subscription pipeline
      (
        subscriber as unknown as {
          subscriptionPipelines: Map<string, unknown>;
        }
      ).subscriptionPipelines.delete(appContext);

      fake.fakeModelChange(MODEL1_ID, []);
      fake.fakeModelDirtyState(MODEL1_ID, true);
      fake.fakeModelValidated(MODEL1_ID, ok());
      fake.fakeModelLoaded(MODEL1_ID);
      fake.fakeModelUnloaded(MODEL1_ID);
      fake.fakeModelHubDisposed();

      await asyncsResolved();
    });

    it("doesn't blow up on bad patch", async () => {
      await subscriber.subscribe(appContext, MODEL1_ID);
      await asyncsResolved();

      const original = cloneDeep(
        await subscriber.getModel(appContext, MODEL1_ID)
      );

      const warn = sandbox.stub(console, 'warn');

      // Issue a bad patch
      fake.fakeModelChange(MODEL1_ID, [
        { op: 'test', path: '/nonesuch', value: '@@impossible@@' },
        { op: 'replace', path: '/name', value: 'NEW NAME' },
      ]);

      await asyncsResolved();

      expect(warn).to.have.been.calledWithMatch(
        'Error applying received model delta'
      );

      const current = await subscriber.getModel(appContext, MODEL1_ID);
      expect(current).to.eql(original);
    });

    it('close the self-subscription at the backend', async () => {
      const sub = await subscriber.subscribe(appContext, MODEL1_ID);
      sub.onModelChanged = onModelChanged;

      fake.closeSubscription(1); // This is the subscriber's self-subscription

      const patch: Operation[] = [
        { op: 'replace', path: '/name', value: MODEL1.name },
      ];
      fake.fakeModelChange(MODEL1_ID, patch);

      await asyncsResolved();

      sinon.assert.notCalled(onModelChanged);
    });
  });

  describe('model cache', () => {
    it('updates by self-subscription', async () => {
      const model = await subscriber.getModel<{ name: string }>(
        appContext,
        MODEL1_ID
      );

      // Issue a patch
      fake.fakeModelChange(MODEL1_ID, [
        { op: 'replace', path: '/name', value: 'NEW NAME' },
      ]);

      await asyncsResolved();

      expect(model.name).to.equal('NEW NAME');
    });

    it('cleans up self-subscription', async () => {
      const original = cloneDeep(
        await subscriber.getModel(appContext, MODEL1_ID)
      );

      (subscriber as FrontendModelHubSubscriberImpl).setModelHub(
        new FakeModelHubProtocol<string>() as unknown as ModelHubProtocol<string>
      );

      // Issue a patch
      fake.fakeModelChange(MODEL1_ID, [
        { op: 'replace', path: '/name', value: 'NEW NAME' },
      ]);

      await asyncsResolved();

      const current = await subscriber.getModel(appContext, MODEL1_ID);
      expect(current).to.eql(original);
    });

    it('purges by self-subscription', async () => {
      (subscriber as FrontendModelHubSubscriberImpl).setModelHub(
        new FakeModelHubProtocol<string>() as unknown as ModelHubProtocol<string>
      );

      // Remove the model
      fake.removeModel(MODEL1_ID);

      await asyncsResolved();

      return expect(subscriber.getModel(appContext, MODEL1_ID)).eventually.to.be
        .rejected;
    });
  });

  describe('model hub tracking', () => {
    it('isModelHubAvailable()', () => {
      expect(tracker.isModelHubAvailable('new-context')).to.be.false;

      fake.fakeModelHubCreated('new-context');

      expect(tracker.isModelHubAvailable('new-context')).to.be.true;
    });

    it('notifies model hub creation', () => {
      const sub = tracker.trackModelHubs();
      sub.onModelHubCreated = sinon.stub();

      fake.fakeModelHubCreated('new-context');
      expect(sub.onModelHubCreated).to.have.been.calledWith('new-context');
    });

    it('notifies extant model hubs', () => {
      fake.fakeModelHubCreated('new-context');

      const sub = tracker.trackModelHubs();
      sub.onModelHubCreated = sinon.stub();

      expect(sub.onModelHubCreated).to.have.been.calledWith('new-context');
    });

    it('unset creation call-back', async () => {
      const callback = sandbox.stub();
      fake.fakeModelHubCreated('new-context');

      const sub = tracker.trackModelHubs();
      sub.onModelHubCreated = callback;
      expect(callback).to.have.been.calledWith('new-context');

      sub.onModelHubCreated = undefined;

      fake.fakeModelHubCreated('second-context');
      expect(callback).to.have.been.calledOnce;
      expect(callback).not.to.have.been.calledWith('second-context');
    });

    it('notifies model hub destruction', () => {
      const sub = tracker.trackModelHubs();
      sub.onModelHubDestroyed = sinon.stub();

      fake.fakeModelHubDestroyed('new-context');
      expect(sub.onModelHubDestroyed).to.have.been.calledWith('new-context');
    });

    it('close subscription', () => {
      const sub = tracker.trackModelHubs();
      sub.onModelHubCreated = sinon.stub();
      sub.onModelHubDestroyed = sinon.stub();

      fake.fakeModelHubCreated('new-context');

      sub.close();

      fake.fakeModelHubDestroyed('new-context');

      expect(sub.onModelHubCreated).to.have.been.called;
      expect(sub.onModelHubDestroyed).not.to.have.been.called;
    });

    it('redundant close of tracking subscription', async () => {
      const sub = tracker.trackModelHubs();
      sub.onModelHubDestroyed = sandbox.stub();

      fake.fakeModelHubCreated('new-context');

      sub.close();
      sub.close(); // Again, doesn't matter

      fake.fakeModelHubDestroyed('new-context');

      expect(sub.onModelHubDestroyed).not.to.have.been.called;
    });

    it('empty tracking subscription is harmless', () => {
      const sub = tracker.trackModelHubs();

      fake.fakeModelHubCreated('new-context');
      fake.fakeModelHubDestroyed('new-context');

      sub.close();
    });

    it('notifies model hub destruction', () => {
      const sub = tracker.trackModelHubs();
      sub.onModelHubDestroyed = sinon.stub();

      fake.fakeModelHubDestroyed('new-context');
      expect(sub.onModelHubDestroyed).to.have.been.calledWith('new-context');
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
