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

import { ModelManagerImpl } from '@eclipse-emfcloud/model-manager/lib/api/model-manager';
import {
  AbstractModelServiceContribution,
  ModelHub,
  ModelHubImpl,
  ModelServiceContribution,
} from '@eclipse-emfcloud/model-service';
import { ModelValidationServiceImpl } from '@eclipse-emfcloud/model-validation';
import { Measurement, bindContribution } from '@theia/core';
import { wait } from '@theia/core/lib/common/promise-util';
import { NodeStopwatch } from '@theia/core/lib/node/performance';
import {
  Container,
  ContainerModule,
  injectable,
} from '@theia/core/shared/inversify';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { get } from 'lodash';
import sinon from 'sinon';
import { ModelHubTracker } from '../../common/model-hub-tracker';
import backendModule from '../backend-module';
import { ModelHubLifecycleContribution } from '../model-hub-lifecycle-contribution';
import { DefaultModelHubManager, ModelHubManager } from '../model-hub-manager';
import { ModelServiceContribution as ModelServiceContributionIdentifier } from '../model-service-contribution';

chai.use(chaiAsPromised);

describe('DefaultModelHubManager', () => {
  const appContext = 'test-app';
  let container: Container;
  let modelHub: ModelHub | undefined;

  let sandbox: sinon.SinonSandbox;
  const contrib1 = {
    id: 'test.contrib1',
    setModelManager: () => undefined,
    setValidationService: () => undefined,
    setModelAccessorBus: () => undefined,
    validationContribution: {
      getValidators: () => [],
    },
  } as unknown as ModelServiceContribution;
  let setModelHub1: sinon.SinonSpy<
    Parameters<ModelServiceContribution['setModelHub']>
  >;

  beforeEach(() => {
    container = new Container();
    container.load(backendModule);

    sandbox = sinon.createSandbox();
    contrib1.setModelHub = setModelHub1 = sandbox.spy(
      (hub) => (modelHub = hub)
    );

    container
      .bind(ModelServiceContributionIdentifier)
      .toConstantValue(contrib1);

    const factory = container.get(DefaultModelHubManager);
    factory.createModelHub(appContext);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('provides hub to contributions', () => {
    sinon.assert.calledWithMatch(
      setModelHub1,
      sinon.match.instanceOf(ModelHubImpl)
    );
  });

  it('initializes model hub', function () {
    // Its being set is verified separately
    assumeThat(this, 'model hub not initialized', () => !!modelHub);
    if (modelHub) {
      expect(modelHub.context).to.equal(appContext);
      expect(modelHub)
        .to.haveOwnProperty('modelManager')
        .that.is.instanceOf(ModelManagerImpl);
      expect(modelHub)
        .to.haveOwnProperty('validationService')
        .that.is.instanceOf(ModelValidationServiceImpl);
    }
  });

  it('injects contributions into model hub', function () {
    // Its being set is verified separately
    assumeThat(this, 'model hub not initialized', () => !!modelHub);
    if (modelHub) {
      const contributions = (
        modelHub as unknown as {
          contributions: Map<string, ModelServiceContribution>;
        }
      ).contributions;

      expect(contributions.get(contrib1.id)).to.equal(contrib1);
    }
  });

  describe('scoped model service contributions', () => {
    let modelHubManager: ModelHubManager;

    beforeEach(() => {
      container = new Container();
      container.load(backendModule);
      const testModule = new ContainerModule((bind) => {
        bind(ModelServiceContributionIdentifier).to(TestContribution);
      });
      container.load(testModule);
      modelHubManager = container.get(DefaultModelHubManager);
    });

    it('different contribution instances per model hub', () => {
      const modelHubA = modelHubManager.getModelHub('context-a');
      const modelHubB = modelHubManager.getModelHub('context-b');

      const contributionA = getContributions(modelHubA).get('testContribution');
      const contributionB = getContributions(modelHubB).get('testContribution');

      expect(contributionA).to.exist;
      expect(contributionB).to.exist;
      expect(contributionA).to.not.equal(contributionB);
    });

    it('different model service instances per model hub', () => {
      const modelHubA = modelHubManager.getModelHub('context-a');
      const modelHubB = modelHubManager.getModelHub('context-b');

      const modelServiceA = modelHubA.getModelService('testContribution');
      const modelServiceB = modelHubB.getModelService('testContribution');

      expect(modelServiceA).to.exist;
      expect(modelServiceB).to.exist;
      expect(modelServiceA).to.not.equal(modelServiceB);
    });
  });

  describe('inversify DI', () => {
    const appContext1 = 'app-a';
    const appContext2 = 'app-b';
    const appContext3 = 'app-c';

    let container: Container;
    let modelHubManager: ModelHubManager;

    beforeEach(() => {
      container = new Container();
      container.load(backendModule);

      modelHubManager = container.get<ModelHubManager>(ModelHubManager);
    });

    it('getModelHub()', () => {
      const hub1 = modelHubManager.getModelHub(appContext1);
      expect(hub1).to.exist;

      const hub2 = modelHubManager.getModelHub(appContext2);
      expect(hub2).to.exist;

      const hub3 = modelHubManager.getModelHub(appContext3);
      expect(hub3).to.exist;

      expect(hub1).not.to.equal(hub2);
      expect(hub1).not.to.equal(hub3);
      expect(hub2).not.to.equal(hub3);

      const hub1Again = modelHubManager.getModelHub(appContext1);
      expect(hub1Again).to.equal(hub1);
    });

    it('disposeContext()', function () {
      const hub1 = modelHubManager.getModelHub(appContext1);
      const hub2 = modelHubManager.getModelHub(appContext2);
      const hub3 = modelHubManager.getModelHub(appContext3);

      const allHubs = () =>
        Array.from(
          (
            modelHubManager as unknown as {
              modelHubs: Map<string, { modelHub: ModelHub<unknown, string> }>;
            }
          ).modelHubs.values()
        ).map((record) => record.modelHub);

      expect(allHubs()).to.have.members([hub1, hub2, hub3]);

      modelHubManager.disposeContext(appContext2);
      expect(allHubs()).to.have.members([hub1, hub3]);
      expect(allHubs()).not.to.include(hub2);

      // doesn't hurt to do it again
      modelHubManager.disposeContext(appContext2);
      expect(allHubs()).to.have.members([hub1, hub3]);
      expect(allHubs()).not.to.include(hub2);
    });

    describe('hub lifecycle contribution providers', () => {
      @injectable()
      class TestModelHubLifecycle implements ModelHubLifecycleContribution {
        getPriority() {
          return 42;
        }

        createModelHub(
          ...args: Parameters<ModelHubLifecycleContribution['createModelHub']>
        ) {
          return new ModelHubImpl(...args);
        }

        async initializeModelHub(
          _modelHub: ModelHub<string, string>
        ): Promise<void> {
          return void undefined;
        }

        disposeModelHub(modelHub: ModelHub<string, string>): void {
          modelHub.dispose();
        }
      }

      beforeEach(() => {
        container = new Container();
        container.bind(TestModelHubLifecycle).toSelf().inSingletonScope();
        bindContribution(container, TestModelHubLifecycle, [
          ModelHubLifecycleContribution,
        ]);
        container.load(backendModule);

        modelHubManager = container.get<ModelHubManager>(ModelHubManager);
      });

      describe('consults priorities', () => {
        it('priority wins', () => {
          const createSpy = sandbox.spy(
            TestModelHubLifecycle.prototype,
            'createModelHub'
          );

          const hub = modelHubManager.getModelHub('some-context');
          expect(createSpy).to.have.returned(hub);
        });

        it('priority defaulted', () => {
          const lifecycle = container.get<ModelHubLifecycleContribution>(
            TestModelHubLifecycle
          );
          lifecycle.getPriority = undefined;

          const createSpy = sandbox.spy(
            TestModelHubLifecycle.prototype,
            'createModelHub'
          );

          const hub = modelHubManager.getModelHub('some-context');
          expect(createSpy).to.have.returned(hub);
        });

        it('opt out via NaN', () => {
          const createSpy = sandbox.spy(
            TestModelHubLifecycle.prototype,
            'createModelHub'
          );
          sandbox
            .stub(TestModelHubLifecycle.prototype, 'getPriority')
            .returns(NaN);

          const hub = modelHubManager.getModelHub('some-context');
          expect(hub).to.exist;
          expect(createSpy).not.to.have.been.called;
        });
      });

      describe('initialization', () => {
        it('initializer not provided', async () => {
          const lifecycle = container.get<ModelHubLifecycleContribution>(
            TestModelHubLifecycle
          );
          lifecycle.initializeModelHub = undefined;

          const hub = modelHubManager.getModelHub('some-context');
          return expect(
            modelHubManager.initializeContext('some-context')
          ).to.eventually.be.equal(hub);
        });

        it('initializer provided', async () => {
          const initializeSpy = sandbox.spy(
            TestModelHubLifecycle.prototype,
            'initializeModelHub'
          );

          const hub = modelHubManager.getModelHub('some-context');
          expect(hub).to.exist;
          await expect(
            modelHubManager.initializeContext('some-context')
          ).to.eventually.be.equal(hub);
          expect(initializeSpy).to.have.been.calledWithExactly(hub);
        });

        it('initialize wrong context', async () => {
          modelHubManager.getModelHub('some-context');
          expect(modelHubManager.initializeContext('other-context')).to
            .eventually.be.rejected;
        });

        describe('concurrent initializations', () => {
          let initialHubCount: number;
          let expectedHubCount: number;

          beforeEach(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            initialHubCount = get(modelHubManager as any, 'modelHubs.size');
            expectedHubCount = initialHubCount + 1;
          });

          afterEach(() => {
            expect(modelHubManager).to.have.nested.property(
              'modelHubs.size',
              expectedHubCount,
              'wrong number of model hubs remaining after test'
            );
          });

          it('initialize only once', async () => {
            const initializeSpy = sandbox.spy(
              TestModelHubLifecycle.prototype,
              'initializeModelHub'
            );

            const hub = modelHubManager.getModelHub('some-context');
            expect(hub).to.exist;
            await Promise.all([
              modelHubManager.initializeContext('some-context'),
              modelHubManager.initializeContext('some-context'),
              modelHubManager.initializeContext('some-context'),
            ]);

            expect(initializeSpy).to.have.been.calledOnce;
          });

          it('all provisions wait', async () => {
            const initializeSpy = sandbox.spy(
              TestModelHubLifecycle.prototype,
              'initializeModelHub'
            );

            const modelHubs = await Promise.all([
              modelHubManager.provideModelHub('some-context'),
              modelHubManager.provideModelHub('some-context'),
              modelHubManager.provideModelHub('some-context'),
            ]);

            expect(initializeSpy).to.have.been.calledOnce;

            // all provisions got the same hub
            expect(modelHubs).to.have.length(3);
            for (let i = 1; i < modelHubs.length; i++) {
              expect(modelHubs[i]).to.be.equal(modelHubs[i - 1]);
            }
          });

          it('timeout waiting for initialization', async function () {
            // Failed hub should be disposed
            expectedHubCount = initialHubCount;

            const testTimeout = this.timeout();
            sandbox
              .stub(TestModelHubLifecycle.prototype, 'initializeModelHub')
              .callsFake(() => wait(testTimeout / 4));

            Object.assign(modelHubManager, {
              initializationTimeoutMs: testTimeout / 8,
            });

            const modelHubs = await Promise.allSettled([
              modelHubManager.provideModelHub('some-context'),
              modelHubManager.provideModelHub('some-context'),
              modelHubManager.provideModelHub('some-context'),
            ]);

            // all provisions timed out
            expect(modelHubs).to.have.length(3);
            for (const hub of modelHubs) {
              expect(hub.status).to.be.equal('rejected');
              expect(hub).to.have.nested.property(
                'reason.message',
                'Model Hub initialization timed out for context: some-context'
              );
            }
          });

          it('failed initialization', async function () {
            // Failed hub should be disposed
            expectedHubCount = initialHubCount;

            Object.assign(modelHubManager, {
              initializationTimeoutMs: 125,
            });

            sandbox
              .stub(TestModelHubLifecycle.prototype, 'initializeModelHub')
              .callsFake(() => Promise.reject(new Error('Boom!')));

            const modelHubs = await Promise.allSettled([
              modelHubManager.provideModelHub('some-context'),
              modelHubManager.provideModelHub('some-context'),
              modelHubManager.provideModelHub('some-context'),
            ]);

            // all provisions errored out
            expect(modelHubs).to.have.length(3);
            for (const hub of modelHubs) {
              expect(hub.status).to.be.equal('rejected');
              expect(hub).to.have.nested.property('reason.message', 'Boom!');
            }
          });

          it('eventual success of initialization', async function () {
            Object.assign(modelHubManager, {
              initializationTimeoutMs: 300,
            });

            const initializeStub = sandbox
              .stub(TestModelHubLifecycle.prototype, 'initializeModelHub')
              .onFirstCall()
              .callsFake(() => Promise.reject(new Error('Boom!')))
              .onSecondCall()
              .callsFake(() => Promise.reject(new Error('Boom!')))
              .callsFake(() => Promise.resolve());

            const modelHubs = await Promise.all([
              modelHubManager.provideModelHub('some-context'),
              modelHubManager.provideModelHub('some-context'),
              modelHubManager.provideModelHub('some-context'),
            ]);

            expect(initializeStub).to.have.been.calledThrice;

            // all provisions got the same hub
            expect(modelHubs).to.have.length(3);
            expect(modelHubs[0]).to.be.instanceOf(ModelHubImpl);
            for (let i = 1; i < modelHubs.length; i++) {
              expect(modelHubs[i]).to.be.equal(modelHubs[i - 1]);
            }
          });
        });

        describe('initialization performance timing', () => {
          let stopwatch: sinon.SinonStubbedInstance<NodeStopwatch>;

          beforeEach(() => {
            stopwatch = sandbox.createStubInstance(NodeStopwatch);
            stopwatch.start.callsFake(
              () =>
                ({
                  log: sandbox.stub(),
                  error: sandbox.stub(),
                } as unknown as Measurement)
            );
            Object.assign(modelHubManager, { stopwatch });
          });

          it('successful initialization', async () => {
            const hub = modelHubManager.getModelHub('some-context');
            expect(hub).to.exist;
            await Promise.all([
              modelHubManager.initializeContext('some-context'),
              modelHubManager.initializeContext('some-context'),
              modelHubManager.initializeContext('some-context'),
            ]);

            expect(stopwatch.start).to.have.been.calledOnceWith(
              'initialize model hub'
            );
            const measurement = stopwatch.start.returnValues[0];

            // Wait for microtasks spawned by the initialization to run
            await wait(1);
            expect(measurement.log).to.have.been.calledOnceWith('complete');
          });

          it('timeout waiting for initialization', async function () {
            const testTimeout = this.timeout();
            sandbox
              .stub(TestModelHubLifecycle.prototype, 'initializeModelHub')
              .callsFake(() => wait(testTimeout / 4));

            Object.assign(modelHubManager, {
              initializationTimeoutMs: testTimeout / 8,
            });

            await Promise.allSettled([
              modelHubManager.provideModelHub('some-context'),
              modelHubManager.provideModelHub('some-context'),
              modelHubManager.provideModelHub('some-context'),
            ]);

            // provision timed out

            expect(stopwatch.start).to.have.been.calledOnceWith(
              'initialize model hub'
            );
            const measurement = stopwatch.start.returnValues[0];
            expect(measurement.error).to.have.been.calledOnceWith('timed out');
          });

          it('failed initialization', async function () {
            Object.assign(modelHubManager, {
              initializationTimeoutMs: 100,
            });

            sandbox
              .stub(TestModelHubLifecycle.prototype, 'initializeModelHub')
              .callsFake(() => Promise.reject(new Error('Boom!')));

            await Promise.allSettled([
              modelHubManager.provideModelHub('some-context'),
              modelHubManager.provideModelHub('some-context'),
              modelHubManager.provideModelHub('some-context'),
            ]);

            // provision errored out

            expect(stopwatch.start).to.have.been.calledOnceWith(
              'initialize model hub'
            );
            const measurement = stopwatch.start.returnValues[0];
            expect(measurement.error).to.have.been.calledOnceWith(
              'failed',
              sinon.match.instanceOf(Error)
            );
          });
        });

        describe('model hub tracking', () => {
          let tracker: ModelHubTracker;

          beforeEach(() => {
            tracker = container.get<ModelHubTracker>(ModelHubTracker);
          });

          it('isModelHubAvailable()', async () => {
            const sub = tracker.trackModelHubs();
            sub.onModelHubCreated = sandbox.stub();

            expect(tracker.isModelHubAvailable('new-context')).to.be.false;

            await modelHubManager.provideModelHub('new-context');

            expect(tracker.isModelHubAvailable('new-context')).to.be.true;
          });

          it('notifies hub creation', async () => {
            const sub = tracker.trackModelHubs();
            sub.onModelHubCreated = sandbox.stub();

            await modelHubManager.provideModelHub('new-context');
            expect(sub.onModelHubCreated).to.have.been.calledWith(
              'new-context'
            );
          });

          it('notifies extant hubs', async () => {
            await modelHubManager.provideModelHub('new-context');

            const sub = tracker.trackModelHubs();
            sub.onModelHubCreated = sandbox.stub();
            expect(sub.onModelHubCreated).to.have.been.calledWith(
              'new-context'
            );
          });

          it('notifies pending hubs later', async () => {
            const futureHub = modelHubManager.provideModelHub('new-context');

            const sub = tracker.trackModelHubs();
            sub.onModelHubCreated = sandbox.stub();

            expect(sub.onModelHubCreated).not.to.have.been.called;

            await futureHub;

            expect(sub.onModelHubCreated).to.have.been.calledWith(
              'new-context'
            );
          });

          it('unset creation call-back', async () => {
            const callback = sandbox.stub();
            await modelHubManager.provideModelHub('new-context');

            const sub = tracker.trackModelHubs();
            sub.onModelHubCreated = callback;
            expect(callback).to.have.been.calledWith('new-context');

            sub.onModelHubCreated = undefined;

            await modelHubManager.provideModelHub('second-context');
            expect(callback).to.have.been.calledOnce;
            expect(callback).not.to.have.been.calledWith('second-context');
          });

          it('notifies hub destruction', async () => {
            await modelHubManager.provideModelHub('new-context');

            const sub = tracker.trackModelHubs();
            sub.onModelHubDestroyed = sandbox.stub();

            modelHubManager.disposeContext('new-context');
            expect(sub.onModelHubDestroyed).to.have.been.calledWith(
              'new-context'
            );
          });

          it('close tracking subscription', async () => {
            const sub = tracker.trackModelHubs();
            sub.onModelHubCreated = sandbox.stub();
            sub.onModelHubDestroyed = sandbox.stub();

            await modelHubManager.provideModelHub('new-context');

            sub.close();

            modelHubManager.disposeContext('new-context');

            expect(sub.onModelHubCreated).to.have.been.calledOnce;
            expect(sub.onModelHubDestroyed).not.to.have.been.called;
          });

          it('redundant close of tracking subscription', async () => {
            const sub = tracker.trackModelHubs();
            sub.onModelHubDestroyed = sandbox.stub();

            await modelHubManager.provideModelHub('new-context');

            sub.close();
            sub.close(); // Again, doesn't matter

            modelHubManager.disposeContext('new-context');

            expect(sub.onModelHubDestroyed).not.to.have.been.called;
          });

          it('empty subscription is harmless', async () => {
            const sub = tracker.trackModelHubs();

            await modelHubManager.provideModelHub('new-context');
            modelHubManager.disposeContext('new-context');

            sub.close();
          });
        });
      });

      describe('disposal', () => {
        it('disposer not provided', async () => {
          const lifecycle = container.get<ModelHubLifecycleContribution>(
            TestModelHubLifecycle
          );
          lifecycle.disposeModelHub = undefined;

          const hub = modelHubManager.getModelHub('some-context');
          const disposeSpy = sandbox.spy(hub, 'dispose');
          modelHubManager.disposeContext('some-context');
          expect(disposeSpy).to.have.been.called;
        });

        it('disposer provided', async () => {
          const disposeSpy = sandbox.spy(
            TestModelHubLifecycle.prototype,
            'disposeModelHub'
          );

          const hub = modelHubManager.getModelHub('some-context');
          expect(hub).to.exist;
          modelHubManager.disposeContext('some-context');
          expect(disposeSpy).to.have.been.calledWithExactly(hub);
        });

        it('dispose wrong context', async () => {
          const hub = modelHubManager.getModelHub('some-context');
          const disposeSpy = sandbox.spy(hub, 'dispose');
          modelHubManager.disposeContext('other-context');
          expect(disposeSpy).not.to.have.been.called;
        });
      });
    });
  });
});

const assumeThat = (
  context: Mocha.Context,
  reason: string,
  predicate: () => boolean
) => {
  if (!predicate()) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    context.test!.title += ' - ' + reason;
    context.skip();
  }
};

@injectable()
class TestContribution extends AbstractModelServiceContribution {
  public modelService = {};
  constructor() {
    super();
    this.initialize({
      id: 'testContribution',
    });
  }

  getModelService<S>(): S {
    return this.modelService as unknown as S;
  }
}

function getContributions(
  modelHub: ModelHub
): Map<string, ModelServiceContribution> {
  return (
    modelHub as unknown as {
      contributions: Map<string, ModelServiceContribution>;
    }
  ).contributions;
}
