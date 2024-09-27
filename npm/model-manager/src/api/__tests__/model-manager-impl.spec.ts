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
import chaiLike from 'chai-like';
import Sinon, { createSandbox, match, SinonSandbox } from 'sinon';
import type { ChangeSubscription, CoreModelManager } from '../../core';
import { CoreCommandStackImpl, CoreModelManagerImpl } from '../../impl';
import { WorkingCopyManager } from '../../impl/core-command-stack-impl';
import { createModelUpdaterCommand } from '../../patch';
import { CommandStackImpl } from '../command-stack';
import { createModelManager, ModelManager } from '../model-manager';

chai.use(chaiLike);

const workingCopyManager: WorkingCopyManager = {
  isOpen: () => true,
  open: () => undefined,
  commit: () => undefined,
  cancel: () => undefined,
  getModel: () => ({}),
  getWorkingCopy: () => ({}),
};

const fakeModelManager = (sandbox: SinonSandbox): CoreModelManager<string> => {
  const result = <CoreModelManager<string>>{};
  result.getModel = sandbox.fake((modelId: string) => ({
    name: modelId,
  })) as CoreModelManager<string>['getModel'];
  result.setModel = sandbox.fake();
  result.getModelId = sandbox.fake((model: { name: string }) => model.name);
  result.getModelIds = sandbox.fake(() => ['A Model']);
  result.removeModel = sandbox.fake((modelId: string) => ({
    name: modelId,
  })) as CoreModelManager<string>['removeModel'];
  result.getCommandStack = sandbox.fake.returns(
    new CoreCommandStackImpl(workingCopyManager)
  );
  result.subscribe = sandbox.fake.returns({
    subscribed: true,
  } as unknown as ChangeSubscription<string>);
  return result;
};

/** Cast an object's method as a verifiable Sinon spy. */
const verify = <R>(
  func: (...args: unknown[]) => R
): Sinon.SinonSpy<unknown[], R> => func as Sinon.SinonSpy<unknown[], R>;

describe('ModelManagerImpl', () => {
  let sandbox: SinonSandbox;
  let core: CoreModelManager<string>;
  let modelManager: ModelManager<string>;
  const model = { name: 'a' };

  beforeEach(() => {
    sandbox = createSandbox();
    core = fakeModelManager(sandbox);
    modelManager = createModelManager(core);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('createModelManager()', () => {
    expect(modelManager).to.haveOwnProperty('delegate').that.equals(core);
  });

  it('createModelManager() with default delegate', () => {
    const myModelManager = createModelManager();
    expect(myModelManager)
      .to.haveOwnProperty('delegate')
      .that.is.an.instanceOf(CoreModelManagerImpl);
  });

  it('getModel()', () => {
    const result = modelManager.getModel('a');
    expect(verify(core.getModel).calledWith('a')).to.be.true;
    expect(result).to.be.like(model);
  });

  it('setModel()', () => {
    modelManager.setModel('a', model);
    expect(verify(core.setModel).calledWith('a', model)).to.be.true;
  });

  it('getModelId()', () => {
    const result = modelManager.getModelId(model);
    expect(verify(core.getModelId).calledWith(model)).to.be.true;
    expect(result).to.be.equal('a');
  });

  it('getModelIds()', () => {
    const result = modelManager.getModelIds();
    expect(verify(core.getModelIds).called).to.be.true;
    expect(result).to.eql(['A Model']);
  });

  it('removeModel()', () => {
    const result = modelManager.removeModel('a');
    expect(verify(core.removeModel).calledWith('a')).to.be.true;
    expect(result).to.be.like(model);
  });

  it('subscribe()', () => {
    const result = modelManager.subscribe();
    expect(verify(core.subscribe).called).to.be.true;
    expect(
      verify(core.subscribe).neverCalledWithMatch(match.defined),
      'subscribe was given an defined argument'
    ).to.be.true;

    expect(result).to.be.equal(verify(core.subscribe).lastCall.returnValue);
  });

  it('subscribe() with model ID', () => {
    const result = modelManager.subscribe('a');
    expect(verify(core.subscribe).calledWith('a')).to.be.true;

    expect(result).to.be.equal(verify(core.subscribe).lastCall.returnValue);
  });

  describe('getCommandStack()', () => {
    it('creates a stack', () => {
      const stack = modelManager.getCommandStack('my.stack');
      expect(stack, 'no stack provided').to.exist;
      expect(stack, 'wrong kind of stack').to.be.an.instanceOf(
        CommandStackImpl
      );
      expect(stack, 'stack has wrong editing context').to.be.like({
        editingContext: 'my.stack',
      });

      expect(verify(core.getCommandStack).called, 'delegate not retrieved').to
        .be.true;

      expect(stack, 'wrong delegate stack')
        .to.have.property('delegate')
        .that.is.equal(verify(core.getCommandStack).firstCall.returnValue);
    });

    it('allows empty id', () => {
      const stack1 = modelManager.getCommandStack('');
      const stack2 = modelManager.getCommandStack('my.stack');

      expect(stack2, 'no stack provided for empty ID').to.exist;
      expect(stack2, 'should not be the same stack').not.to.equal(stack1);
    });
  });

  describe('getCommandStackIds', () => {
    it('no command stacks', () => {
      const stackIds = modelManager.getCommandStackIds();
      expect(verify(core.getCommandStack).called, 'delegate not retrieved').to
        .be.true;
      expect(stackIds, 'unexpected command stacks').to.be.empty;
    });

    it('has command stacks', async () => {
      const stack1 = modelManager.getCommandStack('stack.1');
      let stackIds = modelManager.getCommandStackIds();
      expect(stackIds, 'command stack having no history was returned').to.be
        .empty;

      await stack1.execute(
        createModelUpdaterCommand<string, typeof model>(
          'Test',
          'testing',
          (model) => {
            model.name = 'Alice';
          }
        )
      );

      stackIds = modelManager.getCommandStackIds();
      expect(
        stackIds,
        'command stack having a history was not returned'
      ).to.eql(['stack.1']);
    });
  });

  describe('command stack options', () => {
    it('default options', () => {
      const stack = modelManager.getCommandStack('stack.1');
      expect(stack)
        .to.have.property('options')
        .that.is.like({ keepHistory: true });
    });

    it('keepHistory option false', () => {
      const stack = modelManager.getCommandStack('stack.1', {
        keepHistory: false,
      });
      expect(stack)
        .to.have.property('options')
        .that.is.like({ keepHistory: false });
    });
  });
});
