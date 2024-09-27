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

import Chai, { expect } from 'chai';
import Sinon from 'sinon';
import SinonChai from 'sinon-chai';
import { ModelValidationServiceImpl } from '../model-validation-service';

import { Diagnostic, ok } from '../diagnostic';
import { Validator } from '../validator';

Chai.use(SinonChai);

describe('ModelValidationServiceImpl', () => {
  let modelValidationService: ModelValidationServiceImpl<string>;
  let validatorOK: Validator<string, object>;
  let validatorError: Validator<string, object>;
  let validatorException: Validator<string, object>;
  let validatorReject: Validator<string, object>;
  const customOKInstance: Diagnostic = {
    severity: 'ok',
    source: '@example/test',
    code: '0',
    path: '',
    message: 'Hello.',
  };
  const errorInstance: Diagnostic = {
    severity: 'error',
    source: '@example/test',
    code: '4',
    path: 'foo/errorProp',
    message: 'Error, error!',
  };
  let consoleWarnStub: Sinon.SinonStub<Parameters<typeof console.warn>>;
  beforeEach(() => {
    modelValidationService = new ModelValidationServiceImpl();
    validatorOK = {
      validate: (_modelId: string, _model: object) => {
        return Promise.resolve(customOKInstance);
      },
    };
    validatorError = {
      validate: (_modelId: string, _model: object) => {
        return Promise.resolve(errorInstance);
      },
    };
    validatorException = {
      validate: (_modelId: string, _model: object) => {
        throw new Error('This is an error');
      },
    };
    validatorReject = {
      validate: (_modelId: string, _model: object) => {
        return Promise.reject('rejected Promise');
      },
    };
    consoleWarnStub = Sinon.stub(console, 'warn');
  });
  afterEach(() => {
    consoleWarnStub.restore();
  });
  describe('validate', () => {
    it('validate w/o validator', async () => {
      const result = await modelValidationService.validate('key1', {});
      expect(result).to.be.deep.equal(ok());
    });
    it('getValidationState for ok Diagnostic validate', async () => {
      modelValidationService.addValidator(validatorOK);
      await modelValidationService.validate('key1', {});
      expect(
        modelValidationService.getValidationState('key1')
      ).to.be.deep.equal(ok());
    });
    it('getValidationState for multi validate', async () => {
      modelValidationService.addValidator(validatorOK);
      modelValidationService.addValidator(validatorError);
      await modelValidationService.validate('key1', {});
      expect(
        modelValidationService.getValidationState('key1')
      ).to.be.deep.equal(errorInstance);
    });
    it('throws exception from validator do not crash the whole process', async () => {
      modelValidationService.addValidator(validatorOK);
      modelValidationService.addValidator(validatorException);
      await modelValidationService.validate('key1', {});
      expect(
        modelValidationService.getValidationState('key1')
      ).to.be.deep.equal(ok());
      const msg = `An error occurred within a validator during the validation of 'key1'. Error: This is an error. Validation continues ignoring the failed validator`;
      expect(consoleWarnStub.calledWith(msg)).to.be.true;
    });
    it('rejects the promises from validator do not crash the whole process', async () => {
      modelValidationService.addValidator(validatorOK);
      modelValidationService.addValidator(validatorReject);
      await modelValidationService.validate('key1', {});
      expect(
        modelValidationService.getValidationState('key1')
      ).to.be.deep.equal(ok());
      const msg = `An error occurred within a validator during the validation of 'key1' (cause: rejected Promise). Validation continues ignoring the failed validator`;
      expect(consoleWarnStub.calledWith(msg)).to.be.true;
    });
  });

  describe('subscribe', () => {
    it('subscribe to the updates to the validation state of a single model', async () => {
      const subscription = modelValidationService.subscribe('key1');
      subscription.onValidationChanged = Sinon.spy();
      await modelValidationService.validate('key1', {});
      await modelValidationService.validate('key1', {});
      expect(subscription.onValidationChanged).to.be.calledOnce;
      await modelValidationService.validate('key2', {});
      expect(subscription.onValidationChanged).to.be.calledOnce;
      subscription.close();
      await modelValidationService.validate('key1', {});
      expect(subscription.onValidationChanged).to.be.calledOnce;
    });
    it('subscribe to the updates to the validation state w/o onValidationChanges', async () => {
      const subscriptionA = modelValidationService.subscribe('key1');
      const subscriptionB = modelValidationService.subscribe('key1');
      subscriptionA.onValidationChanged = Sinon.spy();
      await modelValidationService.validate('key1', {});
      expect(subscriptionA.onValidationChanged).to.be.calledOnce;
      subscriptionB.close();
      subscriptionB.close();
    });
    it('subscribe to the updates to the validation state of several models', async () => {
      const subscription = modelValidationService.subscribe(
        'key1',
        'key2',
        'key3'
      );
      subscription.onValidationChanged = Sinon.spy();
      await modelValidationService.validate('key1', {});
      await modelValidationService.validate('key2', {});
      expect(subscription.onValidationChanged).to.be.calledTwice;
      subscription.close();
      await modelValidationService.validate('key1', {});
      await modelValidationService.validate('key2', {});
      await modelValidationService.validate('key3', {});
      expect(subscription.onValidationChanged).to.be.calledTwice;
    });
    it('subscribe to the updates to the validation state of all models', async () => {
      const subscription = modelValidationService.subscribe();
      subscription.onValidationChanged = Sinon.spy();
      await modelValidationService.validate('key1', {});
      await modelValidationService.validate('key2', {});
      expect(subscription.onValidationChanged).to.be.calledTwice;
      await modelValidationService.validate('key2', {});
      expect(subscription.onValidationChanged).to.be.calledTwice;
      subscription.close();
      await modelValidationService.validate('key3', {});
      expect(subscription.onValidationChanged).to.be.calledTwice;
    });
    it('subscribe to the updates to the validation state of all models w/o onValidationChanges', async () => {
      const subscriptionA = modelValidationService.subscribe();
      subscriptionA.onValidationChanged = Sinon.spy();
      const subscriptionB = modelValidationService.subscribe();
      await modelValidationService.validate('key1', {});
      expect(subscriptionA.onValidationChanged).to.be.calledOnce;
      subscriptionB.close();
      subscriptionB.close();
    });
    it('subscribe to the updates of the validation state of several models with one onValidationChanged throwing an error', async () => {
      const subscriptionA = modelValidationService.subscribe(
        'key1',
        'key2',
        'key3'
      );
      subscriptionA.onValidationChanged = (
        _modelId: string,
        _model: object,
        _diagnostic: Diagnostic
      ) => {
        throw new Error('This is an onValidationChanged exception');
      };
      const subscriptionB = modelValidationService.subscribe(
        'key1',
        'key2',
        'key3'
      );
      subscriptionB.onValidationChanged = Sinon.spy();
      await modelValidationService.validate('key1', {});
      const msg1 = `An error occurred within the onValidationChanged callback for 'key1'. Error: This is an onValidationChanged exception. Other subscribers will still be notified ignoring the failed callback`;
      expect(consoleWarnStub.calledWith(msg1)).to.be.true;
      await modelValidationService.validate('key2', {});
      const msg2 = `An error occurred within the onValidationChanged callback for 'key2'. Error: This is an onValidationChanged exception. Other subscribers will still be notified ignoring the failed callback`;
      expect(consoleWarnStub.calledWith(msg2)).to.be.true;
      expect(subscriptionB.onValidationChanged).to.be.calledTwice;
      subscriptionA.close();
      subscriptionB.close();
    });
    it('subscribe to the updates of the validation state of all models with one onValidationChanged throwing an error', async () => {
      const subscriptionA = modelValidationService.subscribe();
      subscriptionA.onValidationChanged = (
        _modelId: string,
        _model: object,
        _diagnostic: Diagnostic
      ) => {
        throw new Error('This is an onValidationChanged exception');
      };
      const subscriptionB = modelValidationService.subscribe();
      subscriptionB.onValidationChanged = Sinon.spy();
      await modelValidationService.validate('key1', {});
      expect(subscriptionB.onValidationChanged).to.be.calledOnce;
      const msg = `An error occurred within the onValidationChanged callback for 'key1'. Error: This is an onValidationChanged exception. Other subscribers will still be notified ignoring the failed callback`;
      expect(consoleWarnStub.calledWith(msg)).to.be.true;
      subscriptionA.close();
      subscriptionB.close();
    });
    it('get current validation state in subscription', async () => {
      modelValidationService.addValidator(validatorError);
      const subscriptionA = modelValidationService.subscribe();
      let currentState: Diagnostic | undefined;
      subscriptionA.onValidationChanged = (
        modelId: string,
        _model: object,
        _diagnostic: Diagnostic
      ) => {
        currentState = modelValidationService.getValidationState(modelId);
      };

      const diagnostic = await modelValidationService.validate('key1', {});
      expect(currentState).to.equal(diagnostic);
      expect(currentState?.severity).to.equal('error');
    });
  });
});
