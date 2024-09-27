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

import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import {
  AbstractModelServiceContribution,
  ModelAccessorContribution,
  ModelPersistenceContribution,
  ModelValidationContribution,
} from '../model-service-contribution';

chai.use(sinonChai);
chai.use(chaiAsPromised);

describe('AbstractModelServiceContribution', () => {
  const id = '@test/contrib';
  let contrib: TestContribution;
  let sandbox: sinon.SinonSandbox;
  let persistenceContribution: ModelPersistenceContribution;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    contrib = new TestContribution();
    persistenceContribution = {
      canHandle: sandbox.stub().returns(true),
      loadModel: sandbox.stub().returns(Promise.resolve({})),
      saveModel: sandbox.stub().returns(Promise.resolve(true)),
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('id', () => {
    contrib.postConstruct({ id });
    expect(contrib.id).to.be.equal('@test/contrib');
  });

  describe('persistenceContribution', () => {
    it('supplied', async () => {
      contrib.postConstruct({
        id,
        persistenceContribution,
      });

      const persistence = contrib.persistenceContribution;
      expect(persistence).to.exist;
      expect(persistence.canHandle('myModel')).to.be.true;
      await persistence.saveModel(
        'myModel',
        await persistence.loadModel('myModel')
      );

      expect(persistenceContribution.canHandle).to.have.been.called;
      expect(persistenceContribution.loadModel).to.have.been.called;
      expect(persistenceContribution.saveModel).to.have.been.called;
    });

    it('defaulted', async () => {
      contrib.postConstruct({ id });

      const persistence = contrib.persistenceContribution;
      expect(persistence).to.exist;

      await expect(persistence.canHandle('myModel')).to.eventually.be.false;
      await expect(persistence.loadModel('myModel')).to.eventually.be.rejected;
      await expect(persistence.saveModel('myModel', {})).to.eventually.be
        .rejected;
    });
  });
});

class TestContribution extends AbstractModelServiceContribution {
  postConstruct({
    id,
    persistenceContribution,
    validationContribution,
    modelAccessorContribution,
  }: {
    id: string;
    persistenceContribution?: ModelPersistenceContribution;
    validationContribution?: ModelValidationContribution;
    modelAccessorContribution?: ModelAccessorContribution;
  }): void {
    this.initialize({
      id,
      persistenceContribution,
      validationContribution,
      modelAccessorContribution,
    });
  }

  getModelService<S>(): S {
    throw new Error('Method not required for testing.');
  }
}
