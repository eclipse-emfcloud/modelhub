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

import { fail } from 'assert';
import Chai, { expect } from 'chai';
import { applyPatch, compare, Operation } from 'fast-json-patch';
import { cloneDeep } from 'lodash';
import Sinon from 'sinon';
import SinonChai from 'sinon-chai';
import type {
  Command,
  CompoundCommand,
  CoreCommandStack,
  EditingContext,
  SimpleCommand,
} from '../../core';
import { append } from '../../core';
import { createModelUpdaterCommand } from '../../patch';
import { WorkingCopyManager } from '../core-command-stack-impl';
import { CoreModelManagerImpl } from '../core-model-manager-impl';

Chai.use(SinonChai);
const editingContext = (id: string): EditingContext => id;

describe('CoreModelManagerImpl', () => {
  let modelManager: CoreModelManagerImpl<string>;
  const key1 = 'model1';
  const key2 = 'model2';
  const model1 = { foo1: 'foo1', bar1: 'bar1' };
  const model2 = { foo2: 'foo2', bar2: 'bar2' };
  let command1: Command;
  let command2: Command;
  let context1: string;
  let context2: string;
  let commandStack: CoreCommandStack;

  const getModel1 = () => {
    const result = modelManager.getModel(key1);
    expect(result).to.exist;
    return result as typeof model1;
  };
  const getModel2 = () => {
    const result = modelManager.getModel(key2);
    expect(result).to.exist;
    return result as typeof model2;
  };

  beforeEach(() => {
    modelManager = new CoreModelManagerImpl();
    command1 = new TestCommand('command1', key1);
    command2 = new TestCommand('command2', key2);
    context1 = editingContext('context1');
    context2 = editingContext('context2');
    commandStack = modelManager.getCommandStack();
  });

  describe('register & retrieve & remove models', () => {
    it('set & get models', () => {
      modelManager.setModel(key1, model1);
      modelManager.setModel(key2, model2);

      const m1 = modelManager.getModel(key1);
      expect(m1, 'model1 has not been set correctly').to.deep.equal(model1);

      const m2 = modelManager.getModel(key2);
      expect(m2, 'model2 has not been set correctly').to.deep.equal(model2);
    });

    it('register a model to an already existing key', () => {
      try {
        modelManager.setModel(key1, model1);
        modelManager.setModel(key1, model2);
      } catch (_err) {
        //success
        return;
      }
      fail('should have thrown an error as key1 already exists');
    });

    it('remove a model', () => {
      modelManager.setModel(key1, model1);
      modelManager.setModel(key2, model2);
      const m1 = modelManager.removeModel(key1);
      expect(m1, 'removed model is not the expected one').to.deep.equal(model1);
      expect(
        modelManager.getModel(key1),
        'removed model should not be present anymore in the modelManager'
      ).to.be.undefined;
      expect(
        modelManager.getModel(key2),
        'removing a model should not changed other registered models'
      ).to.deep.equal(model2);
    });

    it('remove a model not registered', () => {
      modelManager.setModel(key1, model1);
      const m2 = modelManager.removeModel(key2);
      expect(m2, 'no model should be removed').to.be.undefined;
    });

    it('get a model ID', () => {
      modelManager.setModel(key1, model1);
      const _model = modelManager.getModel(key1);
      expect(_model).to.exist;
      const firstEdition = _model as typeof model1;

      expect(modelManager.getModelId(firstEdition)).to.be.equal(key1);

      modelManager.getCommandStack().execute(
        createModelUpdaterCommand<string, typeof model1>(
          'patch',
          key1,
          (model) => {
            model.bar1 = 'New value';
          }
        ),
        context1
      );

      // Historical editions of models are remembered until they're GCed
      expect(modelManager.getModelId(firstEdition)).to.be.equal(key1);
    });

    it('get model IDs', () => {
      expect(modelManager.getModelIds(), 'should not have model IDs').to.eql(
        []
      );

      modelManager.setModel(key1, model1);

      expect(modelManager.getModelIds(), 'should just have model ID 1')
        .to.include(key1)
        .and.have.length(1);

      modelManager.setModel(key2, model2);

      expect(modelManager.getModelIds(), 'should also have model ID 2')
        .to.include(key2)
        .and.have.length(2);

      modelManager.removeModel(key1);

      expect(modelManager.getModelIds(), 'should just have model ID 2')
        .to.include(key2)
        .and.have.length(1);
    });
  });

  describe('manipulating the commandStack', () => {
    it('get commandStack for editing the models', () => {
      modelManager.setModel(key1, model1);
      let commandStack = modelManager.getCommandStack();
      expect(commandStack, 'the commandStack should be defined').to.not.be
        .undefined;
      modelManager.removeModel(key1);
      commandStack = modelManager.getCommandStack();
      expect(
        commandStack,
        'the commandStack should still be defined even when all models are removed'
      ).to.not.be.undefined;
    });

    it('get commandStack for editing the models when no registered model', () => {
      const commandStack = modelManager.getCommandStack();
      expect(
        commandStack,
        'the commandStack should be defined even when no model is registered'
      ).to.not.be.undefined;
    });
  });

  describe('subscription to model changes', () => {
    it('subscribe to an existing model changes', async () => {
      let counter = 0;
      modelManager.setModel(key1, model1);
      modelManager.setModel(key2, model2);
      const sub1 = modelManager.subscribe(key1);
      const sub2 = modelManager.subscribe(key1);
      const sub3 = modelManager.subscribe(key2);
      sub1.onModelChanged = (key, model: Record<string, unknown>, delta) => {
        expect(key).to.equal(key1);
        expect(model).to.be.deep.equal(model1);
        expect(model.command1).to.be.equal('test-value');
        expect(delta).to.be.like([
          { op: 'add', path: 'command1', value: 'test-value' },
        ]);
        counter++;
      };
      sub2.onModelChanged = (key, model: Record<string, unknown>, delta) => {
        expect(key).to.equal(key1);
        expect(model).to.be.deep.equal(model1);
        expect(model.command1).to.be.equal('test-value');
        expect(delta).to.be.like([
          { op: 'add', path: 'command1', value: 'test-value' },
        ]);
        counter++;
      };
      sub3.onModelChanged = Sinon.spy();
      await commandStack.execute(command1, context1);
      expect(counter).to.be.equal(2);
      expect(sub3.onModelChanged).to.be.not.called;
      await commandStack.execute(command2, context2);
      expect(sub3.onModelChanged).to.be.calledOnce;
    });

    it('unsubscribe to an existing model changes', async () => {
      modelManager.setModel(key1, model1);
      const sub1 = modelManager.subscribe(key1);
      sub1.onModelChanged = Sinon.spy();
      const sub2 = modelManager.subscribe(key1);
      sub2.onModelChanged = Sinon.spy();
      const sub3 = modelManager.subscribe(key2);
      sub3.onModelChanged = Sinon.spy();
      sub1.close();
      sub2.close();
      sub3.close();
      await commandStack.execute(command1, context1);
      expect(sub1.onModelChanged).to.be.not.called;
      expect(sub2.onModelChanged).to.be.not.called;
      expect(sub3.onModelChanged).to.be.not.called;
    });

    it('execute a command on closed subscriber for a specific model', async () => {
      modelManager.setModel(key1, model1);
      modelManager.setModel(key2, model1);
      modelManager.subscribe(key1);
      const sub2 = modelManager.subscribe(key2);
      sub2.onModelChanged = Sinon.spy();
      sub2.close();
      await commandStack.execute(command1, context1);
      expect(sub2.onModelChanged).to.not.be.called;
    });

    it('execute a command on closed subscriber for all models', async () => {
      modelManager.setModel(key1, model1);
      modelManager.setModel(key2, model1);
      modelManager.subscribe();
      const sub2 = modelManager.subscribe();
      sub2.onModelChanged = Sinon.spy();
      sub2.close();
      await commandStack.execute(command1, context1);
      expect(sub2.onModelChanged).to.not.be.called;
    });

    it('unsubscribe twice to same modelId', async () => {
      modelManager.setModel(key1, model1);
      const sub = modelManager.subscribe(key1);
      sub.onModelChanged = Sinon.spy();
      sub.close();
      sub.close();
      await commandStack.execute(command1, context1);
      expect(sub.onModelChanged).to.not.be.called;
    });

    it('execute a command with undefined result w/o notification', async () => {
      modelManager.setModel(key1, model1);
      const commandUndefined = new TestCommandUndefined('undefined', key1);
      const sub = modelManager.subscribe(key1);
      sub.onModelChanged = Sinon.spy();
      await commandStack.execute(commandUndefined, context1);
      await commandStack.undo(context1);
      await commandStack.redo(context1);
      expect(sub.onModelChanged).to.not.be.called;
      const commandUndefined2 = new TestCommandUndefined('undefined2', key1);
      await commandStack.executeAndAppend(context1, commandUndefined2);
      const sub2 = modelManager.subscribe(key1);
      sub2.onModelChanged = Sinon.spy();
      expect(sub2.onModelChanged).to.not.be.called;
    });

    it('subscribe to a model changes before having this model registered', async () => {
      const sub = modelManager.subscribe(key2);
      sub.onModelChanged = Sinon.spy();
      modelManager.setModel(key2, model2);
      await commandStack.execute(command2, context2);
      expect(sub.onModelChanged).to.be.calledOnce;
    });

    it('subscribe to all existing model changes', async () => {
      modelManager.setModel(key1, model1);
      modelManager.setModel(key2, model2);
      const sub = modelManager.subscribe();
      sub.onModelChanged = Sinon.spy();
      await commandStack.execute(command1, context1);
      expect(sub.onModelChanged).to.be.calledOnce;
    });

    it('unsubscribe to all model changes w/o having any model registered', async () => {
      const sub1 = modelManager.subscribe();
      const sub2 = modelManager.subscribe();
      sub1.onModelChanged = Sinon.spy();
      sub2.onModelChanged = Sinon.spy();
      sub1.close();
      sub1.close();
      sub2.close();
      modelManager.setModel(key1, model1);
      await commandStack.execute(command1, context1);
      expect(sub1.onModelChanged).to.not.be.called;
      expect(sub2.onModelChanged).to.not.be.called;
    });

    it('subscriber not notified when execute provides no delta', async () => {
      modelManager.setModel(key1, model1);
      const sub = modelManager.subscribe(key1);
      sub.onModelChanged = Sinon.stub();

      // Instrument the command to return no delta
      command1.execute = () => undefined;
      await commandStack.execute(command1, context1);
      expect(sub.onModelChanged).not.to.be.called;
    });

    it('subscriber not notified when undo provides no delta', async () => {
      modelManager.setModel(key1, model1);
      await commandStack.execute(command1, context1);

      const sub = modelManager.subscribe(key1);
      sub.onModelChanged = Sinon.stub();

      // Instrument the command to return no delta on undo
      command1.undo = () => undefined;
      await commandStack.undo(context1);
      expect(sub.onModelChanged).not.to.be.called;
    });

    it('subscriber not notified when redo provides no delta', async () => {
      modelManager.setModel(key1, model1);
      await commandStack.execute(command1, context1);
      await commandStack.undo(context1);

      const sub = modelManager.subscribe(key1);
      sub.onModelChanged = Sinon.stub();

      // Instrument the command to return no delta on redo
      command1.redo = () => undefined;
      await commandStack.redo(context1);
      expect(sub.onModelChanged).not.to.be.called;
    });

    it('subscriber without callback does not break notifications', async () => {
      modelManager.setModel(key1, model1);
      const blankSub = modelManager.subscribe(key1);
      blankSub.onModelChanged = undefined;
      const sub = modelManager.subscribe(key1);
      sub.onModelChanged = Sinon.spy();
      await commandStack.execute(command1, context1);
      expect(sub.onModelChanged).to.be.called;
    });

    it('no subscription call-backs for unmanaged model', async () => {
      // Instrument a compound command to invent a delta on an unmanaged model
      const compoundCommand = append(command1, command2) as CompoundCommand;
      // Sinon doesn't provide the wrapped method for async stub
      const wrappedMethod = compoundCommand.execute;
      Sinon.stub(compoundCommand, 'execute').callsFake(
        async (...args: unknown[]) => {
          const result = (await wrappedMethod.apply(
            compoundCommand,
            args
          )) as Map<Command, Operation[]>;
          result.set(
            new TestCommand('interloper', 'interloper'),
            // May as well be a nonsense "delta"
            [{ op: 'test', path: '/modelIs', value: 'interloper' }]
          );
          return result;
        }
      );

      modelManager.setModel(key1, model1);
      modelManager.setModel(key2, model2);
      const sub = modelManager.subscribe();
      sub.onModelChanged = Sinon.spy();
      await commandStack.execute(compoundCommand, context1);
      expect(sub.onModelChanged).to.be.called;
      expect(sub.onModelChanged).not.to.be.calledWithMatch(
        'interloper',
        Sinon.match.any,
        Sinon.match.any
      );
    });
  });

  describe('Concurrency scenarios', () => {
    beforeEach(() => {
      modelManager.setModel(key1, cloneDeep(model1));
      modelManager.setModel(key2, cloneDeep(model2));
    });

    it('single sequential model undo/redo', async () => {
      await commandStack.execute(
        new AsyncPatchCommand('1', key1, [
          { op: 'test', path: '/bar1', value: 'bar1' },
          { op: 'replace', path: '/bar1', value: 'New Value' },
        ]),
        context1
      );

      await commandStack.execute(
        new AsyncPatchCommand('2', key1, [
          { op: 'test', path: '/bar1', value: 'New Value' },
          { op: 'replace', path: '/bar1', value: '42' },
        ]),
        context1
      );

      expect(getModel1()).to.be.like({
        foo1: 'foo1',
        bar1: '42',
      });

      await commandStack.undo(context1);
      expect(getModel1()).to.be.like({
        foo1: 'foo1',
        bar1: 'New Value',
      });

      await commandStack.undo(context1);
      expect(getModel1()).to.be.like({
        foo1: 'foo1',
        bar1: 'bar1',
      });

      await commandStack.redo(context1);
      expect(getModel1()).to.be.like({
        foo1: 'foo1',
        bar1: 'New Value',
      });

      await commandStack.redo(context1);
      expect(getModel1()).to.be.like({
        foo1: 'foo1',
        bar1: '42',
      });
    });

    it('single stacked model undo/redo', async () => {
      commandStack.execute(
        new AsyncPatchCommand('1', key2, [
          { op: 'test', path: '/bar2', value: 'bar2' },
          { op: 'replace', path: '/bar2', value: 'New Value' },
        ]),
        context1
      );
      await commandStack.execute(
        new AsyncPatchCommand('2', key2, [
          { op: 'test', path: '/bar2', value: 'New Value' },
          { op: 'replace', path: '/bar2', value: '42' },
        ]),
        context1
      );

      expect(getModel2()).to.be.like({
        foo2: 'foo2',
        bar2: '42',
      });

      await commandStack.undo(context1);
      await commandStack.undo(context1);
      expect(getModel2()).to.be.like({
        foo2: 'foo2',
        bar2: 'bar2',
      });

      await commandStack.redo(context1);
      await commandStack.redo(context1);
      expect(getModel2()).to.be.like({
        foo2: 'foo2',
        bar2: '42',
      });
    });

    it('multiple sequential model undo/redo', async () => {
      await commandStack.execute(
        append(
          new AsyncPatchCommand('1a', key1, [
            { op: 'test', path: '/bar1', value: 'bar1' },
            { op: 'replace', path: '/bar1', value: 'New Value' },
          ]),
          new AsyncPatchCommand('1b', key2, [
            { op: 'test', path: '/bar2', value: 'bar2' },
            { op: 'replace', path: '/bar2', value: 'New Value 2' },
          ])
        ),
        context1
      );

      await commandStack.execute(
        append(
          new AsyncPatchCommand('2a', key1, [
            { op: 'test', path: '/bar1', value: 'New Value' },
            { op: 'replace', path: '/bar1', value: '42' },
          ]),
          new AsyncPatchCommand('2b', key2, [
            { op: 'test', path: '/bar2', value: 'New Value 2' },
            { op: 'replace', path: '/bar2', value: '19' },
          ])
        ),
        context1
      );

      expect(getModel1()).to.be.like({
        foo1: 'foo1',
        bar1: '42',
      });
      expect(getModel2()).to.be.like({
        foo2: 'foo2',
        bar2: '19',
      });

      await commandStack.undo(context1);
      expect(getModel1()).to.be.like({
        foo1: 'foo1',
        bar1: 'New Value',
      });
      expect(getModel2()).to.be.like({
        foo2: 'foo2',
        bar2: 'New Value 2',
      });

      await commandStack.undo(context1);
      expect(getModel1()).to.be.like({
        foo1: 'foo1',
        bar1: 'bar1',
      });
      expect(getModel2()).to.be.like({
        foo2: 'foo2',
        bar2: 'bar2',
      });

      await commandStack.redo(context1);
      expect(getModel1()).to.be.like({
        foo1: 'foo1',
        bar1: 'New Value',
      });
      expect(getModel2()).to.be.like({
        foo2: 'foo2',
        bar2: 'New Value 2',
      });

      await commandStack.redo(context1);
      expect(getModel1()).to.be.like({
        foo1: 'foo1',
        bar1: '42',
      });
      expect(getModel2()).to.be.like({
        foo2: 'foo2',
        bar2: '19',
      });
    });

    it('multiple stacked model undo/redo', async () => {
      commandStack.execute(
        append(
          new AsyncPatchCommand('1a', key1, [
            { op: 'test', path: '/bar1', value: 'bar1' },
            { op: 'replace', path: '/bar1', value: 'New Value' },
          ]),
          new AsyncPatchCommand('1b', key2, [
            { op: 'test', path: '/bar2', value: 'bar2' },
            { op: 'replace', path: '/bar2', value: 'New Value 2' },
          ])
        ),
        context1
      );
      await commandStack.execute(
        append(
          new AsyncPatchCommand('2a', key1, [
            { op: 'test', path: '/bar1', value: 'New Value' },
            { op: 'replace', path: '/bar1', value: '42' },
          ]),
          new AsyncPatchCommand('2b', key2, [
            { op: 'test', path: '/bar2', value: 'New Value 2' },
            { op: 'replace', path: '/bar2', value: '19' },
          ])
        ),
        context1
      );

      expect(getModel1()).to.be.like({
        foo1: 'foo1',
        bar1: '42',
      });
      expect(getModel2()).to.be.like({
        foo2: 'foo2',
        bar2: '19',
      });

      await commandStack.undo(context1);
      await commandStack.undo(context1);
      expect(getModel1()).to.be.like({
        foo1: 'foo1',
        bar1: 'bar1',
      });
      expect(getModel2()).to.be.like({
        foo2: 'foo2',
        bar2: 'bar2',
      });

      await commandStack.redo(context1);
      await commandStack.redo(context1);
      expect(getModel1()).to.be.like({
        foo1: 'foo1',
        bar1: '42',
      });
      expect(getModel2()).to.be.like({
        foo2: 'foo2',
        bar2: '19',
      });
    });
  });

  describe('Edge Cases', () => {
    let workingCopyManager: WorkingCopyManager;

    beforeEach(() => {
      workingCopyManager = (
        modelManager as unknown as { _modelStore: WorkingCopyManager }
      )._modelStore;
    });

    it('attempt to open working copy manager already open', () => {
      workingCopyManager.open(['testId']);
      expect(workingCopyManager.isOpen(['testId'])).to.be.true;

      expect(() => workingCopyManager.open(['testId'])).to.throw(
        'Already open'
      );
    });

    it('attempt to get a working copy when not open', () => {
      expect(workingCopyManager.isOpen(['testId'])).to.be.false;

      expect(() => workingCopyManager.getWorkingCopy('foo')).to.throw(
        'Not open'
      );
    });

    it('attempt to get a working copy for nonexistent model', () => {
      workingCopyManager.open(['testId']);

      expect(() => workingCopyManager.getWorkingCopy('none such')).to.throw(
        'Not open'
      );
    });

    it('attempt to get a working copy for nonexistent model', () => {
      workingCopyManager.open(['nonesuch']);

      try {
        expect(workingCopyManager.getWorkingCopy('nonesuch')).to.be.undefined;
      } finally {
        workingCopyManager.cancel(['nonesuch']);
      }
    });

    it('commit a delta for non-open model', () => {
      expect(workingCopyManager.isOpen(['nonesuch'])).to.be.false;

      workingCopyManager.open([key1]);
      expect(workingCopyManager.isOpen([key1])).to.be.true;
      workingCopyManager.getWorkingCopy(key1);

      const results = new Map<Command<string>, Operation[]>();
      results.set(
        new TestCommandUndefined('Working Copies Test', 'nonesuch'),
        []
      );
      try {
        workingCopyManager.commit(results);

        expect(workingCopyManager.isOpen(['nonesuch'])).to.be.false;
        expect(workingCopyManager.isOpen([key1])).to.be.true;
      } finally {
        workingCopyManager.cancel([key1]);
      }
    });

    describe('concurrent working copy sets', () => {
      const key3 = 'model3';
      const key4 = 'model4';
      const model3 = { foo3: 'foo3', bar3: 'bar3' };
      const model4 = { foo4: 'foo4', bar4: 'bar4' };

      beforeEach(() => {
        (
          [
            [key1, model1],
            [key2, model2],
            [key3, model3],
            [key4, model4],
          ] as const
        ).forEach(([key, model]) => modelManager.setModel(key, model));
      });

      afterEach(() => {
        const modelIds = [key4, key3, key2, key1];
        workingCopyManager.cancel(modelIds);
        modelIds.forEach(modelManager.removeModel.bind(modelManager));
      });

      it('non-conflicting open', () => {
        workingCopyManager.open([key1, key3]);
        expect(workingCopyManager.isOpen([key1, key3])).to.be.true;
        expect(workingCopyManager.isOpen([key1, key2, key3, key4])).to.be.true;
        expect(workingCopyManager.isOpen([key2, key4])).to.be.false;
        workingCopyManager.open([key2, key4]);
        expect(workingCopyManager.isOpen([key2, key4])).to.be.true;
        expect(workingCopyManager.isOpen([key1, key2, key3, key4])).to.be.true;
      });

      it('non-conflicting working copy cancel', () => {
        workingCopyManager.open([key1, key3]);
        workingCopyManager.open([key2, key4]);
        expect(workingCopyManager.getWorkingCopy(key1)).to.be.like(model1);
        expect(workingCopyManager.getWorkingCopy(key2)).to.be.like(model2);
        expect(workingCopyManager.getWorkingCopy(key3)).to.be.like(model3);
        expect(workingCopyManager.getWorkingCopy(key4)).to.be.like(model4);
        workingCopyManager.cancel([key2, key4]);
        expect(workingCopyManager.getWorkingCopy(key1)).to.be.like(model1);
        expect(workingCopyManager.getWorkingCopy(key3)).to.be.like(model3);

        expect(() => workingCopyManager.getWorkingCopy(key2)).to.throw();
        expect(() => workingCopyManager.getWorkingCopy(key4)).to.throw();
      });

      it('working copy conflict', () => {
        workingCopyManager.open([key1, key3]);
        expect(workingCopyManager.getWorkingCopy(key1)).to.be.like(model1);
        expect(workingCopyManager.getWorkingCopy(key3)).to.be.like(model3);
        expect(() => workingCopyManager.open([key2, key3])).to.throw();
        expect(workingCopyManager.isOpen([key1, key3])).to.be.true;
        expect(workingCopyManager.isOpen([key2, key3])).to.be.true; // It's "some" semantics, not "every"
        expect(workingCopyManager.isOpen([key2])).to.be.false;
      });
    });
  });
});

class TestCommand implements SimpleCommand {
  constructor(public readonly label: string, public readonly modelId = '') {}

  public wasExecuted = false;
  public wasUndone = false;
  public wasRedone = false;

  canExecute(): boolean {
    return !this.wasExecuted && !this.wasUndone && !this.wasRedone;
  }

  canUndo(): boolean {
    return this.wasExecuted || this.wasRedone;
  }

  canRedo(): boolean {
    return this.wasUndone;
  }

  execute(model: object): Operation[] | undefined {
    if (!this.canExecute()) {
      throw new Error('cannot execute');
    }
    this.wasExecuted = true;
    this.wasUndone = false;
    this.wasRedone = false;
    Object.defineProperty(model, this.label, {
      value: 'test-value',
      writable: true,
    });
    return [{ op: 'add', path: this.label, value: 'test-value' }];
  }

  undo(model: object): Operation[] | undefined {
    if (!this.canUndo()) {
      throw new Error('cannot undo');
    }
    this.wasExecuted = false;
    this.wasUndone = true;
    this.wasRedone = false;
    Reflect.deleteProperty(model, this.label);
    return [{ op: 'remove', path: this.label }];
  }

  redo(model: object): Operation[] | undefined {
    if (!this.canRedo()) {
      throw new Error('cannot redo');
    }
    this.wasExecuted = false;
    this.wasUndone = false;
    this.wasRedone = true;
    Object.defineProperty(model, this.label, {
      value: 'test-value',
      writable: true,
    });
    return [{ op: 'add', path: this.label, value: 'test-value' }];
  }
}

class TestCommandUndefined implements SimpleCommand {
  constructor(public readonly label: string, public readonly modelId = '') {}

  public wasExecuted = false;
  public wasUndone = false;
  public wasRedone = false;

  canExecute(): boolean {
    return !this.wasExecuted && !this.wasUndone && !this.wasRedone;
  }

  canUndo(): boolean {
    return this.wasExecuted || this.wasRedone;
  }

  canRedo(): boolean {
    return this.wasUndone;
  }

  execute(): Operation[] | undefined {
    if (!this.canExecute()) {
      throw new Error('cannot execute');
    }
    this.wasExecuted = true;
    this.wasUndone = false;
    this.wasRedone = false;
    return undefined;
  }

  undo(): Operation[] | undefined {
    if (!this.canUndo()) {
      throw new Error('cannot undo');
    }
    this.wasExecuted = false;
    this.wasUndone = true;
    this.wasRedone = false;
    return undefined;
  }

  redo(): Operation[] | undefined {
    if (!this.canRedo()) {
      throw new Error('cannot redo');
    }
    this.wasExecuted = false;
    this.wasUndone = false;
    this.wasRedone = true;
    return undefined;
  }
}

class AsyncPatchCommand implements SimpleCommand {
  constructor(
    public readonly label: string,
    public readonly modelId: string,
    private patch: Operation[]
  ) {}

  async canExecute(): Promise<boolean> {
    return this.canApplyAndReverse();
  }

  async canUndo(): Promise<boolean> {
    return this.canApplyAndReverse();
  }

  async canRedo(): Promise<boolean> {
    return this.canApplyAndReverse();
  }

  private async canApplyAndReverse(): Promise<boolean> {
    return this.patch.length > 0;
  }

  execute(model: object): Promise<Operation[]> {
    return this.applyAndReverse(model);
  }

  undo(model: object): Promise<Operation[]> {
    return this.applyAndReverse(model);
  }

  redo(model: object): Promise<Operation[]> {
    return this.applyAndReverse(model);
  }

  private async applyAndReverse(model: object): Promise<Operation[]> {
    const baseline = cloneDeep(model);
    applyPatch(model, this.patch);

    const result = compare(baseline, model, true);
    this.patch = compare(model, baseline);

    return result;
  }
}
