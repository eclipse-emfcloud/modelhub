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
  DefaultProvider,
  ModelAccessorBusImpl,
} from '@eclipse-emfcloud/model-accessor-bus';
import {
  CommandStack,
  CompoundCommandImpl,
  ModelUpdater,
  createModelManager,
  createModelUpdaterCommand,
} from '@eclipse-emfcloud/model-manager';
import { ModelManager } from '@eclipse-emfcloud/model-manager/lib/api/model-manager';
import {
  Diagnostic,
  ModelValidationServiceImpl,
  Validator,
  ok,
} from '@eclipse-emfcloud/model-validation';
import {
  Trigger,
  TriggerEngineImpl,
  addOrReplaceOperations,
} from '@eclipse-emfcloud/trigger-engine';
import { fail } from 'assert';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import chaiLike from 'chai-like';
import { Operation } from 'fast-json-patch';
import { cloneDeep } from 'lodash';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import { ModelHub } from '../../api/model-hub';
import {
  AbstractModelServiceContribution,
  ModelServiceContribution,
} from '../../api/model-service-contribution';
import { ModelTrigger } from '../../api/model-trigger';
import { HubAwareProvider } from '../hub-aware-accessor-provider';
import { ModelHubImpl } from '../model-hub-impl';
import { createModelServiceModelManager } from '../model-service-model-manager';
import { ModelTriggerEngine } from '../model-trigger-engine';

chai.use(sinonChai);
chai.use(chaiLike);
chai.use(chaiAsPromised);

const MODEL_A_ID = 'test.extA';
const MODEL_B_ID = 'test.extB';
const MODEL_C_ID = 'test.extC';

describe('ModelHubImpl', () => {
  let modelHub: ModelHub;
  let modelManager: ModelManager<string>;
  const testContext = {};
  let testContributionA: TestContributionA;
  let testContributionB: TestContributionB;
  let sandbox: sinon.SinonSandbox;

  /**
   * Create the model hub for a test. This emulates the initialization
   * of the hub expected to be implemented in a host application.
   *
   * @param contributions model service contributions to install in our test hub
   */
  const createModelHub = (
    createMM?: typeof createModelManager | ModelServiceContribution,
    ...contributions: ModelServiceContribution[]
  ) => {
    const theCreateMM =
      typeof createMM === 'function' ? createMM : createModelManager;
    modelManager = theCreateMM();

    const theContribs =
      createMM === undefined || typeof createMM === 'function'
        ? contributions
        : [createMM, ...contributions];
    const validationService = new ModelValidationServiceImpl<string>();
    const modelAccessorBus = new ModelAccessorBusImpl();
    modelHub = new ModelHubImpl(
      testContext,
      modelManager,
      validationService,
      modelAccessorBus
    );

    // First, add all contributions
    theContribs.forEach(modelHub.addModelServiceContribution.bind(modelHub));

    // Then inject the hub into them
    theContribs.forEach((contrib) => contrib.setModelHub(modelHub));
  };

  const editA = async (value: number) => {
    const modelService =
      modelHub.getModelService<TestModelServiceA>('testContributionA');
    expect(modelService).to.exist;
    await modelService?.setValue('editorA', MODEL_A_ID, value);
  };
  const undoA = () => modelHub.undo('editorA');
  const redoA = () => modelHub.redo('editorA');

  const editB = async (value: number) => {
    const modelService =
      modelHub.getModelService<TestModelServiceA>('testContributionA');
    expect(modelService).to.exist;
    await modelService?.setValue('editorB', MODEL_B_ID, value);
  };
  const undoB = () => modelHub.undo('editorB');
  const redoB = () => modelHub.redo('editorB');

  const getModelA = () => modelHub.getModel<typeof originalModelA>(MODEL_A_ID);
  const getModelB = () => modelHub.getModel<typeof originalModelB>(MODEL_B_ID);

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    persistedModelA = cloneDeep(originalModelA);
    persistedModelB = cloneDeep(originalModelB);

    testContributionA = new TestContributionA();
    testContributionB = new TestContributionB();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('load and get model', async () => {
    createModelHub(testContributionA);
    const modelA = await modelHub.getModel(MODEL_A_ID);
    expect(modelA).to.be.deep.equal(originalModelA);
  });

  it('load, get, save models', async () => {
    createModelHub(testContributionA, testContributionB);

    // load both models
    await expect(getModelA()).to.eventually.be.deep.equal(originalModelA);
    await expect(getModelB()).to.eventually.be.deep.equal(originalModelB);

    // Modify both models
    await editA(7);
    await editB(42);

    await modelHub.save('editorA');
    // Model A was saved, model B is only modified in memory
    expect(persistedModelA).to.be.deep.equal(await getModelA());
    expect(persistedModelB).to.be.deep.equal(originalModelB);

    await modelHub.save('editorB');
    // Model A and B were saved
    expect(persistedModelA).to.be.deep.equal(await getModelA());
    expect(persistedModelB).to.be.deep.equal(await getModelB());

    // Modify and save both models together
    await editA(3);
    await editB(45);
    await modelHub.save('editorA', 'editorB');

    expect(persistedModelA).to.be.deep.equal(await getModelA());
    expect(persistedModelB).to.be.deep.equal(await getModelB());
  });

  it('save all models', async () => {
    createModelHub(testContributionA, testContributionB);

    // load both models

    await expect(getModelA()).to.eventually.be.deep.equal(originalModelA);
    await expect(getModelB()).to.eventually.be.deep.equal(originalModelB);

    // Modify and save all models
    await editA(7);
    await editB(42);
    await modelHub.save();
    expect(persistedModelA).to.be.deep.equal(await getModelA());
    expect(persistedModelB).to.be.deep.equal(await getModelB());
  });

  it('save after undo', async () => {
    createModelHub(testContributionA);

    await expect(getModelA()).to.eventually.be.deep.equal(originalModelA);

    await editA(7);

    await modelHub.save('editorA');
    expect(persistedModelA).to.be.deep.equal(await getModelA());

    // Undo the edit of model A
    await modelHub.undo('editorA');

    // Now only the redo stack has knowledge of the model to save
    await modelHub.save('editorA');

    expect(persistedModelA).to.be.deep.equal(originalModelA);
  });

  it('save after compound command', async () => {
    createModelHub(testContributionA, testContributionB);

    // load both models

    await expect(getModelA()).to.eventually.be.deep.equal(originalModelA);
    await expect(getModelB()).to.eventually.be.deep.equal(originalModelB);

    // Modify both models in a compound command
    const command = new CompoundCommandImpl(
      'Test Compound',
      updateModelA((model) => {
        model.value = 42;
      }),
      updateModelB((model) => {
        model.value = 42;
      })
    );

    await modelManager.getCommandStack('both').execute(command);

    await modelHub.save('both');

    // Model A and B were both saved
    expect(persistedModelA).to.be.deep.equal(await getModelA());
    expect(persistedModelB).to.be.deep.equal(await getModelB());
  });

  // This test is needed to cover the case of undefined key for a model
  // referenced by a command, where that model is not managed by the
  // hub's model manager (so poor programming practice in the client)
  it('save with a secret model', async () => {
    createModelHub(testContributionA, testContributionB);

    // load the models
    await getModelA();
    await getModelB();

    // Modify both models in a compound command
    const command = new CompoundCommandImpl(
      'Test Compound',
      updateModelA((model) => {
        model.value = 42;
      }),
      updateModelB((model) => {
        model.value = 42;
      })
    );

    await modelManager.getCommandStack('both').execute(command);

    // Now sneakily remove model B
    modelManager.removeModel(MODEL_B_ID);

    await modelHub.save('both');

    // Model A was saved and B was resurrected by commit of the edit
    expect(persistedModelA).to.be.deep.equal(await getModelA());
    expect(persistedModelB).to.be.deep.equal(await getModelB());
  });

  it('model editing', async () => {
    createModelHub(testContributionA, testContributionB);

    await modelHub.getModel(MODEL_A_ID);
    const subA = modelHub.subscribe(MODEL_A_ID);

    let lastChange: Operation[] | undefined;
    let lastModel: object | undefined;
    let lastModelId: string | undefined;
    subA.onModelChanged = (modelId, model, delta) => {
      lastChange = delta;
      lastModel = model;
      lastModelId = modelId;
    };

    await editA(3);

    let patchOperations = lastChange?.filter((op) => op.op !== 'test');
    expect(patchOperations).to.be.an('array').of.length(1);
    if (patchOperations !== undefined) {
      expect(patchOperations[0].op).to.be.equal('replace');
      if ('value' in patchOperations[0]) {
        expect(patchOperations[0].value).to.be.equal(3);
      }
    }
    expect(lastModelId).to.be.equal(MODEL_A_ID);
    expect(lastModel).to.be.equal(await getModelA());

    await modelHub.undo('editorA');

    patchOperations = lastChange?.filter((op) => op.op !== 'test');
    expect(patchOperations).to.be.an('array').of.length(1);
    if (patchOperations !== undefined) {
      expect(patchOperations[0].op).to.be.equal('replace');
      if ('value' in patchOperations[0]) {
        expect(patchOperations[0].value).to.be.equal(5);
      }
    }
    expect(lastModelId).to.be.equal(MODEL_A_ID);
    expect(lastModel).to.be.equal(await getModelA());

    await modelHub.redo('editorA');

    patchOperations = lastChange?.filter((op) => op.op !== 'test');
    expect(patchOperations).to.be.an('array').of.length(1);
    if (patchOperations !== undefined) {
      expect(patchOperations[0].op).to.be.equal('replace');
      if ('value' in patchOperations[0]) {
        expect(patchOperations[0].value).to.be.equal(3);
      }
    }
    expect(lastModelId).to.be.equal(MODEL_A_ID);
    expect(lastModel).to.be.equal(await getModelA());
  });

  it('model contributions', async () => {
    createModelHub(testContributionA, testContributionB);

    const modelA = await getModelA();
    expect(modelA).to.be.deep.equal(originalModelA);
    const modelB = await getModelB();
    expect(modelB).to.be.deep.equal(originalModelB);
  });

  it('duplicate contributions', () => {
    createModelHub(testContributionA);
    try {
      modelHub.addModelServiceContribution(testContributionA);
    } catch (error) {
      // Expected error
      return;
    }
    fail('Adding a duplicate contribution should throw an error');
  });

  it('validate models', async () => {
    createModelHub(testContributionA, testContributionB);

    const diagnostics = await modelHub.validateModels(MODEL_A_ID, MODEL_B_ID);
    expect(diagnostics.severity).to.be.equal('ok');

    await editA(12);
    const diagnosticA = await modelHub.validateModels(MODEL_A_ID);
    expect(diagnosticA.severity).to.be.equal('error');
    expect(diagnosticA.source).to.be.equal('ValidatorA');

    await editB(8);
    const diagnosticB = await modelHub.validateModels(MODEL_B_ID);
    expect(diagnosticB.severity).to.be.equal('error');
    expect(diagnosticB.source).to.be.equal('ValidatorB');

    const validationStateA = modelHub.getValidationState(MODEL_A_ID);
    const validationStateB = modelHub.getValidationState(MODEL_B_ID);

    expect(validationStateA?.severity).to.be.equal('error');
    expect(validationStateA?.source).to.be.equal('ValidatorA');

    expect(validationStateB?.severity).to.be.equal('error');
    expect(validationStateB?.source).to.be.equal('ValidatorB');
  });

  it('validate all models', async () => {
    createModelHub(testContributionA, testContributionB);
    // We don't want live validation to precompute validation state for this test
    modelHub.liveValidation = false;

    let diagnostic = await modelHub.validateModels();
    expect(diagnostic).to.be.like({
      severity: 'ok',
      source: '@eclipse-emfcloud/model-validation',
    });

    await editA(12);
    diagnostic = await modelHub.validateModels();
    expect(diagnostic).to.be.like({ severity: 'error', source: 'ValidatorA' });

    await editB(8);

    // We haven't yet validated B, so it won't be in the validation state
    let validationState = modelHub.getValidationState();
    expect(validationState).to.be.deep.equal(diagnostic);

    diagnostic = await modelHub.validateModels();
    expect(diagnostic).to.be.like({
      severity: 'error',
      source: '', // No unique source
      children: [
        { severity: 'error', source: 'ValidatorA' },
        { severity: 'error', source: 'ValidatorB' },
      ],
    });

    // Test deep equality because iteration order should be stable (if otherwise indeterminate)
    validationState = modelHub.getValidationState();
    expect(validationState).to.be.deep.equal(diagnostic);
  });

  it('validate all models (no models extant)', async () => {
    createModelHub();
    // We don't want live validation to precompute validation state for this test
    modelHub.liveValidation = false;

    let validationState = modelHub.getValidationState();
    expect(validationState).not.to.exist;

    const diagnostics = await modelHub.validateModels();
    expect(diagnostics.severity).to.be.equal('ok');

    // This is the unique case where running a validation cannot cache
    // the validation state because there are no models for which to
    // cache it
    validationState = modelHub.getValidationState();
    expect(validationState).not.to.exist;
  });

  it('validate requested for unknown models', async () => {
    createModelHub(testContributionA, {
      id: 'testContributionQ',
      persistenceContribution: {
        canHandle: (modelId: string) =>
          Promise.resolve(modelId.endsWith('.extQ')),
        loadModel: () => Promise.reject('None such'),
        saveModel: () => Promise.resolve(true),
      },
      validationContribution: {
        getValidators: () => [],
      },
      setModelManager: () => undefined,
      setValidationService: () => undefined,
      setModelHub: () => undefined,
      setModelAccessorBus: () => undefined,
      getModelService: <S>() => ({} as S),
    });
    // We don't want live validation to precompute validation state for this test
    modelHub.liveValidation = false;

    // Load a model that does exist and make it invalid
    await modelHub.getModel(MODEL_A_ID);
    await editA(12);
    const diagnostic = await modelHub.validateModels('test.extQ', MODEL_A_ID);
    expect(diagnostic.severity).to.be.equal('error');
    expect(diagnostic.children).to.be.an('array').of.length(2);
    expect(diagnostic.children?.[0].source).to.be.equal(
      '@eclipse-emfcloud/model-service'
    );
    expect(diagnostic.children?.[1].source).to.be.equal('ValidatorA');
  });

  it('dirty state', async () => {
    createModelHub(testContributionA);
    await getModelA();
    expect(modelHub.isDirty('editorA')).to.be.false;

    await editA(9);
    expect(modelHub.isDirty('editorA')).to.be.true;

    // Undo/Redo should change the dirty state
    await modelHub.undo('editorA');
    expect(modelHub.isDirty('editorA')).to.be.false;
    await modelHub.redo('editorA');
    expect(modelHub.isDirty('editorA')).to.be.true;

    // Save the model; it shouldn't be dirty
    let saved = await modelHub.save('editorA');
    expect(modelHub.isDirty('editorA')).to.be.false;
    expect(saved).to.be.true;

    // Try to save again
    saved = await modelHub.save('editorA');
    expect(saved).to.be.false;
  });

  it('dirty state after flush', async () => {
    createModelHub(testContributionA);
    await getModelA();
    expect(modelHub.isDirty('editorA')).to.be.false;

    await editA(42);

    let changed = modelHub.flush('editorA');
    expect(modelHub.isDirty('editorA')).to.be.true;
    expect(changed).to.be.true;

    // Try flushing again
    changed = modelHub.flush('editorA');
    expect(changed).to.be.false;
  });

  it('dirty state notifications', async () => {
    createModelHub(testContributionA);
    const callback = sandbox.stub();
    const sub = modelHub.subscribe();
    sub.onModelDirtyState = callback;

    await getModelA();
    expect(callback).not.to.have.been.called;

    await editA(9);
    let modelA = await getModelA();
    expect(callback).to.have.been.calledOnce;
    expect(callback).to.have.been.calledWith(MODEL_A_ID, modelA, true);
    callback.resetHistory();

    // Undo/Redo should notify the dirty state
    await modelHub.undo('editorA');
    modelA = await getModelA();
    expect(callback).to.have.been.calledOnce;
    expect(callback).to.have.been.calledWith(MODEL_A_ID, modelA, false);
    callback.resetHistory();
    await modelHub.redo('editorA');
    modelA = await getModelA();
    expect(callback).to.have.been.calledOnce;
    expect(callback).to.have.been.calledWith(MODEL_A_ID, modelA, true);
    callback.resetHistory();

    // Save the model; it should notify
    await modelHub.save('editorA');
    modelA = await getModelA();
    expect(callback).to.have.been.calledOnce;
    expect(callback).to.have.been.calledWith(MODEL_A_ID, modelA, false);
    callback.resetHistory();

    // Try to save again
    await modelHub.save('editorA');
    expect(callback).not.to.have.been.called;
    callback.resetHistory();
  });

  it('undo-redo', async () => {
    createModelHub(testContributionA);

    // Undo/redo without changes
    let changed = await modelHub.undo('editorA');
    await expect(getModelA()).to.eventually.be.deep.equal(originalModelA);
    expect(changed).to.be.false;

    changed = await modelHub.redo('editorA');
    await expect(getModelA()).to.eventually.be.deep.equal(originalModelA);
    expect(changed).to.be.false;

    // Modify the model, then undo/redo
    await editA(1);

    await expect(getModelA()).to.eventually.have.property('value', 1);

    changed = await modelHub.undo('editorA');
    await expect(getModelA()).to.eventually.be.deep.equal(originalModelA);
    await expect(getModelA()).to.eventually.have.property('value', 5);
    expect(changed).to.be.true;

    changed = await modelHub.redo('editorA');
    await expect(getModelA()).to.eventually.have.property('value', 1);
    expect(changed).to.be.true;

    modelHub.flush('editorA');
    await modelHub.undo('editorA');
    // Undo is no longer available after flush; value shouldn't change
    await expect(getModelA()).to.eventually.have.property('value', 1);
  });

  it('validation subscription', async () => {
    createModelHub(testContributionA, testContributionB);
    // We do not want live validation for this test
    modelHub.liveValidation = false;

    const subA = modelHub.subscribe(MODEL_A_ID);
    const subB = modelHub.subscribe(MODEL_B_ID);

    let diagA: Diagnostic | undefined;
    let diagB: Diagnostic | undefined;
    subA.onModelValidated = (_modelId, _model, diagnostic) => {
      diagA = diagnostic;
    };
    subB.onModelValidated = (_modelId, _model, diagnostic) => {
      diagB = diagnostic;
    };

    await modelHub.validateModels(MODEL_A_ID, MODEL_B_ID);

    expect(diagA).to.not.be.undefined;
    expect(diagB).to.not.be.undefined;

    if (diagA && diagB) {
      expect(diagA.severity).to.be.equal('ok');
      expect(diagB.severity).to.be.equal('ok');
    }

    // Close first subscription; subB should still work, but we shouldn't receive
    // changes from subA
    diagA = undefined;
    subA.close();

    await modelHub.validateModels(MODEL_A_ID, MODEL_B_ID);
    expect(diagA).to.be.undefined;
    expect(diagB).to.not.be.undefined;
    if (diagB) {
      expect(diagB.severity).to.be.equal('ok');
    }
  });

  it('live validation', async () => {
    createModelHub(
      createModelServiceModelManager,
      testContributionA,
      testContributionB
    );
    expect(modelHub.liveValidation, 'live validation must be on by default').to
      .be.true;

    const spy = sandbox.spy(modelHub, 'validateModels');

    const sub = modelHub.subscribe(MODEL_A_ID, MODEL_B_ID);
    sub.onModelValidated = sandbox.stub();

    await modelHub.getModel(MODEL_A_ID);
    await asyncsResolved();
    expect(
      sub.onModelValidated,
      'model not validated on load'
    ).to.have.been.calledWithMatch(MODEL_A_ID, sinon.match.any, ok());
    expect(spy).to.have.been.calledOnceWithExactly('test.extA');
    spy.resetHistory();

    await editA(12);
    await editB(8);

    await asyncsResolved();
    expect(sub.onModelValidated).to.have.been.calledWithMatch(
      MODEL_A_ID,
      sinon.match.any,
      {
        severity: 'error',
        source: 'ValidatorA',
      }
    );
    expect(sub.onModelValidated).to.have.been.calledWithMatch(
      MODEL_B_ID,
      sinon.match.any,
      {
        severity: 'error',
        source: 'ValidatorB',
      }
    );
    expect(spy).to.have.been.calledThrice; // B once for model load and once for change
    expect(spy).to.have.been.calledWithExactly('test.extA');
    expect(spy).to.have.been.calledWithExactly('test.extB');

    await undoA();
    await undoB();

    await asyncsResolved();
    expect(sub.onModelValidated).to.have.been.calledWithMatch(
      MODEL_A_ID,
      sinon.match.any,
      ok()
    );
    expect(sub.onModelValidated).to.have.been.calledWithMatch(
      MODEL_B_ID,
      sinon.match.any,
      ok()
    );

    modelHub.liveValidation = false;
    sandbox.reset(); // Forget the history of calls

    await redoA();
    await redoB();

    await asyncsResolved();

    expect(sub.onModelValidated).not.to.have.been.called;
    expect(spy).not.to.have.been.called;

    // try to turn it off again
    modelHub.liveValidation = false;
    expect(modelHub.liveValidation).to.be.false;

    await undoA();
    await undoB();
    await asyncsResolved();
    expect(sub.onModelValidated).not.to.have.been.called;
    expect(spy).not.to.have.been.called;
  });

  it('live validation off', async () => {
    createModelHub(
      createModelServiceModelManager,
      testContributionA,
      testContributionB
    );
    modelHub.liveValidation = false;

    const spy = sandbox.spy(modelHub, 'validateModels');

    const sub = modelHub.subscribe(MODEL_A_ID, MODEL_B_ID);
    sub.onModelValidated = sandbox.stub();

    await modelHub.getModel(MODEL_A_ID);
    await asyncsResolved();

    expect(sub.onModelValidated, 'model validated on load').not.to.have.been
      .called;
    expect(spy).not.to.have.been.called;
  });

  it('multiple subscriptions', async () => {
    createModelHub(testContributionA, testContributionB);
    const sub1 = modelHub.subscribe(MODEL_A_ID);
    const sub2 = modelHub.subscribe(MODEL_A_ID);

    let lastModelId1: string | undefined;
    let lastModel1: object | undefined;
    let lastChange1: Operation[] | undefined;

    let lastModelId2: string | undefined;
    let lastModel2: object | undefined;
    let lastChange2: Operation[] | undefined;

    sub1.onModelChanged = (modelId, model, delta) => {
      lastModelId1 = modelId;
      lastModel1 = model;
      lastChange1 = delta;
    };

    sub2.onModelChanged = (modelId, model, delta) => {
      lastModelId2 = modelId;
      lastModel2 = model;
      lastChange2 = delta;
    };

    await editA(7);

    expect(lastModelId1).to.be.equal(lastModelId2);
    expect(lastModel1).to.be.equal(lastModel2);
    expect(lastChange1).to.be.equal(lastChange2);

    expect(lastModelId1).to.be.equal(MODEL_A_ID);
    expect(lastModel1).to.be.equal(await getModelA());

    const change = lastChange1?.filter((op) => op.op !== 'test');
    expect(change).to.be.an('array').of.length(1);
    if (change !== undefined) {
      expect(change[0].op).to.be.equal('replace');
      if (change[0].op === 'replace') {
        expect(change[0].value).to.be.equal(7);
      }
    }
  });

  it('subscribe to multiple models', async () => {
    createModelHub(testContributionA, testContributionB);
    // We do not want live validation for this test
    modelHub.liveValidation = false;

    const sub = modelHub.subscribe(MODEL_A_ID, MODEL_B_ID);

    let onModelChanged;
    sub.onModelChanged = onModelChanged = sinon.stub();
    let onModelValidated;
    sub.onModelValidated = onModelValidated = sinon.stub();

    await editA(7);
    const modelA = await getModelA();
    sinon.assert.calledWith(onModelChanged, MODEL_A_ID, modelA);

    await editB(42);
    const modelB = await getModelB();
    sinon.assert.calledWith(onModelChanged, MODEL_B_ID, modelB);

    await modelHub.validateModels(MODEL_A_ID, MODEL_B_ID);

    sinon.assert.calledWith(onModelValidated, MODEL_A_ID, modelA);
    sinon.assert.calledWith(onModelValidated, MODEL_B_ID, modelB);
  });

  it('subscribe to all models', async () => {
    createModelHub(testContributionA, testContributionB);
    // We do not want live validation for this test
    modelHub.liveValidation = false;

    const sub = modelHub.subscribe();

    let onModelChanged;
    sub.onModelChanged = onModelChanged = sinon.stub();
    let onModelValidated;
    sub.onModelValidated = onModelValidated = sinon.stub();

    await editA(7);
    const modelA = await getModelA();
    sinon.assert.calledWith(onModelChanged, MODEL_A_ID, modelA);

    await editB(42);
    const modelB = await getModelB();
    sinon.assert.calledWith(onModelChanged, MODEL_B_ID, modelB);

    await modelHub.validateModels(MODEL_A_ID, MODEL_B_ID);

    sinon.assert.calledWith(onModelValidated, MODEL_A_ID, modelA);
    sinon.assert.calledWith(onModelValidated, MODEL_B_ID, modelB);
  });

  it('close subscriptions', async () => {
    createModelHub(testContributionA);

    await getModelA();
    const sub1 = modelHub.subscribe(MODEL_A_ID);
    const sub2 = modelHub.subscribe(MODEL_A_ID);

    try {
      sub1.close();
      sub1.close();

      sub2.close();
      sub2.close();
    } catch (error) {
      fail(
        "calling ModelServiceSubscription.close() multiple times shouldn't cause an error"
      );
    }
  });

  it('close a universal subscription', async () => {
    createModelHub(testContributionA, testContributionB);

    await getModelA();
    await getModelB();
    const sub = modelHub.subscribe();

    let onModelChanged;
    sub.onModelChanged = onModelChanged = sinon.stub();
    let onModelValidated;
    sub.onModelValidated = onModelValidated = sinon.stub();

    sub.close();

    await editA(7);
    await editB(42);

    sinon.assert.notCalled(onModelChanged);

    await modelHub.validateModels(MODEL_A_ID, MODEL_B_ID);

    sinon.assert.notCalled(onModelValidated);
  });

  it('empty subscriptions', async () => {
    createModelHub(testContributionA);

    await getModelA();
    const emptySub = modelHub.subscribe(MODEL_A_ID);

    try {
      await modelHub.validateModels(MODEL_A_ID);
      await editA(13);
    } catch (error) {
      fail("empty subscriptions shouldn't cause errors");
    }

    emptySub.close();
  });

  it('non-existent model service', () => {
    createModelHub(testContributionA);
    const service = modelHub.getModelService(MODEL_B_ID);
    expect(service).to.be.undefined;
  });

  it('save undefined model', async () => {
    createModelHub(testContributionA);

    // Save a model that hasn't been loaded (yet)
    try {
      modelHub.save('editorA');
    } catch (error) {
      fail(
        "saving a model that hasn't yet been loaded shouldn't throw an error"
      );
    }
  });

  it('save unsupported model', async () => {
    createModelHub(testContributionA);
    modelManager.setModel('test.extQ', {});

    await modelManager.getCommandStack('editorQ').execute(
      updateModel('Edit Q', 'test.extQ', (model) => {
        model.value = 42;
      })
    );

    // No registered contribution handles this
    try {
      await modelHub.save('editorQ');
    } catch (error) {
      // Expected error
      return;
    }
    fail(
      "saving a model that isn't supported by any contribution should throw an error"
    );
  });

  it('undefined validation state', () => {
    createModelHub(testContributionA);

    // Get validation state for a model that doesn't exist
    let diagnostic = modelHub.getValidationState(MODEL_B_ID);
    expect(diagnostic).not.to.exist;

    // Get validation state for a model that hasn't been loaded yet
    diagnostic = modelHub.getValidationState(MODEL_A_ID);
    expect(diagnostic).not.to.exist;
  });

  describe('dispose', () => {
    it('the model hub', () => {
      createModelHub(testContributionA, testContributionB);

      modelHub.liveValidation = true;

      expect(modelHub.isDisposed).to.be.false;

      modelHub.dispose();

      expect(modelHub.isDisposed).to.be.true;
    });

    it('the model service contributions', () => {
      const disposeA = sandbox.stub().throws();
      Object.assign(testContributionA, { dispose: disposeA });
      const disposeB = sandbox.stub();
      Object.assign(testContributionB, { dispose: disposeB });
      const consoleStub = sandbox.stub(console, 'error');

      createModelHub(testContributionA, testContributionB);

      modelHub.dispose();

      expect(disposeA).to.have.been.called;
      expect(consoleStub).to.have.been.calledWithMatch(/Uncaught exception.*/);

      expect(disposeB).to.have.been.called;
    });

    it('notifies subscribers', () => {
      const modelSub = modelHub.subscribe('test.extA');
      const closeSpy = sandbox.spy(modelSub, 'close');
      const hubSub = modelHub.subscribe();
      const onDispose = sandbox.stub();
      hubSub.onModelHubDisposed = onDispose;

      modelHub.dispose();

      expect(onDispose).to.have.been.called;
      expect(closeSpy).to.have.been.called;
    });
  });

  it('no multiple concurrent lazy loading', async () => {
    createModelHub(new TestContributionC2());
    modelHub.liveValidation = false;

    const setModelSpy = sandbox.spy(modelManager, 'setModel');

    // initiate multiple concurrent accesses to the unloaded model, requiring lazy load
    const promises = [
      modelHub.getModel('test.extC'),
      modelHub.getModel('test.extC'),
      modelHub.getModel('test.extC'),
    ];

    const actual = await Promise.all(promises);
    expect(actual).to.have.length.at.least(3);
    expect(actual[0]).to.be.deep.equal({
      type: 'modelC',
      id: 'testModelC',
      value: 1,
    });
    expect(actual[1]).to.equal(actual[0], 'not the same model instance');
    expect(actual[2]).to.equal(actual[0], 'not the same model instance');
    expect(modelManager.getModel('test.extC')).to.equal(actual[0]);

    // Nothing remains pending
    const pending = (
      modelHub as unknown as { pendingLoads: Map<string, object> }
    ).pendingLoads;
    expect(pending).to.be.empty;

    // Only one attempt to set the lazily loaded model
    expect(setModelSpy).to.be.calledOnceWith('test.extC', actual[0]);
  });

  describe('Model Accessors', () => {
    it('model accessor bus', () => {
      const spy = sandbox.spy(testContributionA, 'setModelAccessorBus');
      createModelHub(testContributionA);
      const modelAccessorBus = modelHub.getModelAccessorBus();
      expect(modelAccessorBus).to.exist;
      expect(spy).to.have.been.calledWithExactly(modelAccessorBus);
    });

    it('registers model accessor provider', async () => {
      createModelHub();
      const modelAccessorBus = modelHub.getModelAccessorBus();
      const spy = sandbox.spy(modelAccessorBus, 'register');
      modelHub.addModelServiceContribution(testContributionA);
      expect(spy).to.have.been.calledTwice;
      expect(spy).to.have.been.calledWith(modelAccessorProvider);
      expect(spy).to.have.been.calledWith(hubAwareProvider);
    });

    it('sets model hub to hub-aware provider', async () => {
      const spy = sandbox.spy(hubAwareProvider, 'setModelHub');
      createModelHub(testContributionA);
      expect(spy).to.have.been.calledOnceWith(modelHub);
    });
  });

  describe('Model Triggers', () => {
    let testContributionC: TestContributionC;
    let addTriggerSpy: sinon.SinonSpy<
      Parameters<TriggerEngineImpl['addTrigger']>
    >;
    let adaptTriggerSpy: sinon.SinonSpy<
      Parameters<ModelTriggerEngine['adaptTrigger']>
    >;

    const getModelC = () =>
      modelHub.getModel<typeof originalModelC>(MODEL_C_ID);

    const editC = async (id: string) => {
      // Ensure existence of the model before trying to edit it
      await getModelC();
      const command = updateModelC((model) => {
        model.id = id;
      });
      await modelManager.getCommandStack('editorC').execute(command);
    };
    const undoC = () => modelHub.undo('editorC');
    const redoC = () => modelHub.redo('editorC');

    beforeEach(() => {
      persistedModelC = { ...originalModelC };
      testContributionC = new TestContributionC();
      addTriggerSpy = sandbox.spy(TriggerEngineImpl.prototype, 'addTrigger');
      adaptTriggerSpy = sandbox.spy(
        ModelTriggerEngine.prototype,
        'adaptTrigger' as keyof ModelTriggerEngine
      );
      createModelHub(createModelServiceModelManager, testContributionC);
    });

    it('registers triggers in order of provision', () => {
      expect(adaptTriggerSpy).to.have.been.calledTwice;
      expect(addTriggerSpy).to.have.been.calledTwice;

      const triggerWrapping = new Map<ModelTrigger, Trigger>();
      for (let i = 0; i < adaptTriggerSpy.callCount; i++) {
        triggerWrapping.set(
          adaptTriggerSpy.args[i][0],
          adaptTriggerSpy.returnValues[i]
        );
      }

      const firstTrigger = addTriggerSpy.args[0][0];
      const secondTrigger = addTriggerSpy.args[1][0];

      expect(firstTrigger).to.be.equal(triggerWrapping.get(triggerC));
      expect(secondTrigger).to.be.like(triggerWrapping.get(dummyTrigger));
    });

    it('applies triggers on execute', async () => {
      await editC('abcdefghijklmnopqrstuvwxyz');
      const modelC = await getModelC();

      expect(modelC.value).to.equal(26);
    });

    it('unless we have no trigger engine', async () => {
      // Create a hub without trigger engine
      createModelHub(createModelManager, testContributionC);

      const oldValue = (await getModelC()).value;

      await editC('abcdefghijklmnopqrstuvwxyz');
      const modelC = await getModelC();

      expect(modelC.value).to.equal(oldValue);
    });

    it('applies triggers on executeAndAppend', async () => {
      // Load model C
      await getModelC();

      // This doesn't hit the trigger
      let command = updateModelC((model) => {
        model.value = 42;
      });
      await modelManager.getCommandStack('editorC').execute(command);
      await expect(getModelC()).to.eventually.have.property('value', 42);

      // But this does
      command = updateModelC((model) => {
        model.id = 'abcdefghijklmnopqrstuvwxyz';
      });
      await modelManager.getCommandStack('editorC').executeAndAppend(command);
      await expect(getModelC()).to.eventually.have.property('value', 26);
    });

    it('applies triggers on undo', async function () {
      const oldValue = (await getModelC()).value;

      assumeThat(this, 'cannot detect change in value', () => oldValue !== 26);

      await editC('abcdefghijklmnopqrstuvwxyz');
      const baseline = await getModelC();
      assumeThat(this, 'execute case fails', () => baseline.value === 26);

      await undoC();
      await expect(getModelC()).to.eventually.have.property('value', oldValue);
    });

    it('applies triggers on redo', async function () {
      const oldValue = (await getModelC()).value;

      assumeThat(this, 'cannot detect change in value', () => oldValue !== 26);

      await editC('abcdefghijklmnopqrstuvwxyz');
      let baseline = await getModelC();
      assumeThat(this, 'execute case fails', () => baseline.value === 26);

      await undoC();
      baseline = await getModelC();
      assumeThat(this, 'undo case fails', () => baseline.value === oldValue);

      await redoC();
      await expect(getModelC()).to.eventually.have.property('value', 26);
    });
  });

  describe('Model Load Subscriptions', () => {
    it('universal', async () => {
      createModelHub(
        createModelServiceModelManager,
        testContributionA,
        testContributionB
      );
      const sub = modelHub.subscribe();
      sub.onModelLoaded = sandbox.stub();

      await modelHub.getModel('test.extA');
      await asyncsResolved();
      expect(
        sub.onModelLoaded,
        'model A load not notified'
      ).to.have.been.calledWith('test.extA');

      await modelHub.getModel('test.extB');
      await asyncsResolved();
      expect(
        sub.onModelLoaded,
        'model B load not notified'
      ).to.have.been.calledWith('test.extB');
    });

    it('targeted', async () => {
      createModelHub(
        createModelServiceModelManager,
        testContributionA,
        testContributionB
      );
      const sub = modelHub.subscribe('test.extA');
      sub.onModelLoaded = sandbox.stub();

      await modelHub.getModel('test.extA');
      await asyncsResolved();
      expect(
        sub.onModelLoaded,
        'model A load not notified'
      ).to.have.been.calledWith('test.extA');

      await modelHub.getModel('test.extB');
      await asyncsResolved();
      expect(
        sub.onModelLoaded,
        'model B load notified'
      ).not.to.have.been.calledWith('test.extB');
    });

    it('close', async () => {
      createModelHub(
        createModelServiceModelManager,
        testContributionA,
        testContributionB
      );
      const sub = modelHub.subscribe();
      sub.onModelLoaded = sandbox.stub();

      await modelHub.getModel('test.extA');
      await asyncsResolved();
      expect(
        sub.onModelLoaded,
        'model A load not notified'
      ).to.have.been.calledWith('test.extA');

      sub.close();

      await modelHub.getModel('test.extB');
      await asyncsResolved();
      expect(
        sub.onModelLoaded,
        'model B load notified'
      ).not.to.have.been.calledWith('test.extB');
    });

    it('exception', async () => {
      createModelHub(
        createModelServiceModelManager,
        testContributionA,
        testContributionB
      );
      const sub = modelHub.subscribe();
      sub.onModelLoaded = sandbox.stub().throws();
      const consoleStub = sandbox.stub(console, 'error');

      await modelHub.getModel('test.extA');
      await asyncsResolved();
      expect(consoleStub, 'Error not logged').to.have.been.calledWith(
        sinon.match(/Uncaught exception.*/),
        sinon.match.instanceOf(Error)
      );
    });

    it('model creation', async () => {
      createModelHub(createModelServiceModelManager);
      const sub = modelHub.subscribe();
      sub.onModelLoaded = sandbox.stub();

      modelManager.setModel('test', { name: 'Test Model' });

      expect(sub.onModelLoaded, 'model creation not notified as load').to.have
        .been.called;
    });
  });

  describe('Model Unload Subscriptions', () => {
    it('universal', async () => {
      createModelHub(
        createModelServiceModelManager,
        testContributionA,
        testContributionB
      );

      const modelA = await modelHub.getModel('test.extA');
      await asyncsResolved();

      const sub = modelHub.subscribe();
      sub.onModelUnloaded = sandbox.stub();

      modelManager.removeModel('test.extA');

      expect(
        sub.onModelUnloaded,
        'model A unload not notified'
      ).to.have.been.calledWith('test.extA', modelA);
    });

    it('targeted', async () => {
      createModelHub(
        createModelServiceModelManager,
        testContributionA,
        testContributionB
      );

      const modelA = await modelHub.getModel('test.extA');
      await modelHub.getModel('test.extB');
      await asyncsResolved();

      const sub = modelHub.subscribe('test.extA');
      sub.onModelUnloaded = sandbox.stub();

      modelManager.removeModel('test.extA');

      expect(
        sub.onModelUnloaded,
        'model A unload not notified'
      ).to.have.been.calledWith('test.extA', modelA);

      modelManager.removeModel('test.extB');

      expect(
        sub.onModelUnloaded,
        'model B unload notified'
      ).not.to.have.been.calledWithMatch('test.extB', sinon.match.any);
    });

    it('exception', async () => {
      createModelHub(
        createModelServiceModelManager,
        testContributionA,
        testContributionB
      );
      await modelHub.getModel('test.extA');
      await asyncsResolved();

      const sub = modelHub.subscribe();
      sub.onModelUnloaded = sandbox.stub().throws();
      const consoleStub = sandbox.stub(console, 'error');

      modelManager.removeModel('test.extA');

      expect(consoleStub, 'Error not logged').to.have.been.calledWith(
        sinon.match(/Uncaught exception.*/),
        sinon.match.instanceOf(Error)
      );
    });
  });

  describe('Corner Cases', () => {
    let stack: CommandStack;

    beforeEach(async () => {
      // Force some unusual conditions just for these tests
      stack = modelManager.getCommandStack('editorA');
      stack.canUndo = () => Promise.resolve(true);
      stack.canRedo = () => Promise.resolve(true);
      modelManager.getCommandStack = () => stack;
      const validationService = new ModelValidationServiceImpl<string>();
      const modelAccessorBus = new ModelAccessorBusImpl();
      modelHub = new ModelHubImpl(
        testContext,
        modelManager,
        validationService,
        modelAccessorBus
      );
    });

    it('undo returning an empty model diff', async () => {
      stack.undo = () => Promise.resolve(new Map());

      const result = await modelHub.undo('editorA');
      expect(result).to.be.false;
    });

    it('redo returning an empty model diff', async () => {
      stack.redo = () => Promise.resolve(new Map());

      const result = await modelHub.redo('editorA');
      expect(result).to.be.false;
    });

    it('undo returning an undefined model diff', async () => {
      stack.undo = () => Promise.resolve(undefined);

      const result = await modelHub.undo('editorA');
      expect(result).to.be.false;
    });

    it('redo returning an undefined model diff', async () => {
      stack.redo = () => Promise.resolve(undefined);

      const result = await modelHub.redo('editorA');
      expect(result).to.be.false;
    });
  });
});

const originalModelA = {
  type: 'modelA',
  id: 'testModelA',
  value: 5,
};
let persistedModelA = { ...originalModelA };

const originalModelB = {
  type: 'modelB',
  id: 'testModelB',
  value: 18,
};
let persistedModelB = { ...originalModelB };

const originalModelC = {
  type: 'modelC',
  id: 'testModelC',
  value: 10,
};
let persistedModelC = { ...originalModelC };

class TestModelServiceA<K = string> {
  constructor(
    private modelHub: ModelHub<K>,
    private modelManager: ModelManager<K>
  ) {
    // Empty constructor
  }
  async setValue(
    commandStackId: string,
    modelId: K,
    value: number
  ): Promise<Operation[] | undefined> {
    const patchCommand = createModelUpdaterCommand<K, { value: number }>(
      'Set value',
      modelId,
      (model) => {
        model.value = value;
      }
    );
    // Ensure that the model is loaded
    await this.modelHub.getModel(modelId);
    const result = await this.modelManager
      .getCommandStack(commandStackId)
      .execute(patchCommand);
    return result?.get(patchCommand);
  }
}

class TestContributionA extends AbstractModelServiceContribution<
  string,
  typeof originalModelA
> {
  private modelService: TestModelServiceA;

  constructor() {
    super();

    this.initialize({
      id: 'testContributionA',
      persistenceContribution: {
        canHandle(modelId) {
          return Promise.resolve(modelId.endsWith('extA'));
        },
        loadModel(_modelId) {
          return Promise.resolve({ ...persistedModelA });
        },
        saveModel(_modelId, model) {
          persistedModelA = { ...model };
          return Promise.resolve(true);
        },
      },
      validationContribution: {
        getValidators() {
          return [validatorA];
        },
      },
      modelAccessorContribution: {
        getProviders() {
          return [modelAccessorProvider, hubAwareProvider];
        },
      },
    });
  }

  getModelService<S>(): S {
    if (this.modelService === undefined) {
      this.modelService = new TestModelServiceA(
        this.modelHub,
        this.modelManager
      );
    }
    return this.modelService as S;
  }
}

class TestContributionB extends AbstractModelServiceContribution<
  string,
  typeof originalModelB
> {
  constructor() {
    super();

    this.initialize({
      id: 'testContributionB',
      persistenceContribution: {
        canHandle(modelId) {
          return Promise.resolve(modelId.endsWith('extB'));
        },
        loadModel(_modelId) {
          return Promise.resolve({ ...persistedModelB });
        },
        saveModel(_modelId, model) {
          persistedModelB = { ...model };
          return Promise.resolve(true);
        },
      },
      validationContribution: {
        getValidators() {
          return [validatorB];
        },
      },
    });
  }

  getModelService<S>() {
    return {
      /* No API */
    } as S;
  }
}

class TestContributionC extends AbstractModelServiceContribution<
  string,
  typeof originalModelC
> {
  constructor() {
    super();

    this.initialize({
      id: 'testContributionC',
      persistenceContribution: {
        canHandle(modelId) {
          return Promise.resolve(modelId.endsWith('extC'));
        },
        loadModel(_modelId) {
          return Promise.resolve({ ...persistedModelC });
        },
        saveModel(_modelId, model) {
          persistedModelC = { ...model };
          return Promise.resolve(true);
        },
      },
      triggerContribution: {
        getTriggers() {
          return [triggerC, dummyTrigger];
        },
      },
    });
  }

  getModelService<S>() {
    return {
      /* No API */
    } as S;
  }
}

class TestContributionC2 extends AbstractModelServiceContribution<
  string,
  typeof originalModelC
> {
  constructor() {
    super();

    let nextValue = 0;
    this.initialize({
      id: 'testContributionC2',
      persistenceContribution: {
        canHandle(modelId) {
          return Promise.resolve(modelId.endsWith('extC'));
        },
        async loadModel(_modelId) {
          // A different model each time, so that multiple concurrent
          // "loads" would result in different content
          return { ...persistedModelC, value: ++nextValue };
        },
        saveModel(_modelId, model) {
          persistedModelC = { ...model };
          return Promise.resolve(true);
        },
      },
    });
  }

  getModelService<S>() {
    return {
      /* No API */
    } as S;
  }
}

const validatorA: Validator<string, typeof originalModelA> = {
  async validate(modelId, model) {
    const source = 'ValidatorA';
    if (!modelId.endsWith('extA')) {
      return ok(source);
    }
    if (model.value < 0 || model.value > 10) {
      return <Diagnostic>{
        severity: 'error',
        message: 'value must be between 0 and 10',
        path: 'test-path',
        source,
      };
    }
    return ok(source);
  },
};

const validatorB: Validator<string, typeof originalModelB> = {
  async validate(modelId, model) {
    const source = 'ValidatorB';
    if (!modelId.endsWith('extB')) {
      return ok(source);
    }
    if (model.value < 10) {
      return <Diagnostic>{
        severity: 'error',
        message: 'value must greater than 10',
        path: 'test-path',
        source,
      };
    }
    return ok(source);
  },
};

const triggerC: ModelTrigger<string, typeof originalModelC> = {
  async getPatch(modelId, model, delta) {
    if (!modelId.endsWith('extC')) {
      return undefined;
    }
    const op = addOrReplaceOperations(delta)[0];
    if (op && op.path === '/id') {
      if (model.value !== model.id.length) {
        const patch: Operation[] = [
          {
            op: 'value' in model ? 'replace' : 'add',
            path: '/value',
            value: model.id.length,
          },
        ];
        return patch;
      }
    }
    return undefined;
  },
};

const dummyTrigger: ModelTrigger<string, typeof originalModelC> = {
  getPatch: () => undefined,
};

const modelAccessorProvider = new DefaultProvider('test-provider');
const hubAwareProvider = new HubAwareProvider('test-hub-aware-provider');

const asyncsResolved = () =>
  new Promise<void>((resolve) => {
    setImmediate(resolve);
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

const updateModel = (
  label: string,
  modelId: string,
  updater: ModelUpdater<string, typeof originalModelA>
) =>
  createModelUpdaterCommand<string, typeof originalModelA>(
    label,
    modelId,
    updater
  );
const updateModelA = (updater: ModelUpdater<string, typeof originalModelA>) =>
  createModelUpdaterCommand<string, typeof originalModelA>(
    'Edit A',
    MODEL_A_ID,
    updater
  );
const updateModelB = (updater: ModelUpdater<string, typeof originalModelB>) =>
  createModelUpdaterCommand<string, typeof originalModelB>(
    'Edit B',
    MODEL_B_ID,
    updater
  );
const updateModelC = (updater: ModelUpdater<string, typeof originalModelC>) =>
  createModelUpdaterCommand<string, typeof originalModelC>(
    'Edit C',
    MODEL_C_ID,
    updater
  );
