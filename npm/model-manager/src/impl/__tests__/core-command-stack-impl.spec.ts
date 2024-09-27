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

/* eslint-disable @typescript-eslint/no-non-null-assertion */
import chai, { expect } from 'chai';
import chaiLike from 'chai-like';
import type { Operation } from 'fast-json-patch';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import type {
  Command,
  CompoundCommand,
  EditingContext,
  MaybePromise,
  SimpleCommand,
} from '../../core';
import { isCompoundCommand, append as normalAppend } from '../../core';
import {
  append,
  AppendableCompoundCommand,
  CoreCommandStackImpl,
  StackEntry,
  WorkingCopyManager,
} from '../core-command-stack-impl';

chai.use(chaiLike);
chai.use(sinonChai);

chaiLike.extend({
  match: (o: unknown) => o instanceof Map,
  assert: (o: Map<unknown, unknown>, expected: Map<unknown, unknown>) => {
    for (const [key, value] of expected.entries()) {
      if (o.size !== expected.size) {
        return false;
      }
      if (o.get(key) !== value) {
        return false;
      }
    }
    return true;
  },
});

const workingCopyManager: WorkingCopyManager = {
  isOpen: () => true,
  open: () => undefined,
  commit: () => undefined,
  cancel: () => undefined,
  getModel: () => ({}),
  getWorkingCopy: () => ({}),
  createFollowUpCommand: () => undefined,
};

/**
 * An `EditingContext` constructor to abstract its implementation
 * as a mere string identifier.
 */
const editingContext = (id: string): EditingContext => id;

describe('StackEntry', () => {
  let command1: Command;
  let command2: Command;
  const context1 = editingContext('context.1');
  const context2 = editingContext('context.2');

  beforeEach(() => {
    command1 = new TestCommand('a');
    command2 = new TestCommand('b');
  });

  it('provides access to its command', () => {
    const entry = new StackEntry(command1, []);
    expect(entry.command, 'no command').to.be.equal(command1);
  });

  it('provides access to its editing contexts', () => {
    const entry = new StackEntry(command1, [context1, context2]);
    expect(entry.editingContexts, 'missing context 1').to.include(context1);
    expect(entry.editingContexts, 'missing context 2').to.include(context2);
  });

  describe('isPurgeable', () => {
    let entry: StackEntry;

    beforeEach(() => {
      entry = new StackEntry(command1, [context1, context2]);
    });

    it('is not purgeable', () => {
      expect(entry.isPurgeable, 'should not be purgeable').to.be.false;
      entry.editingContexts.delete(context1);
      expect(entry.isPurgeable, 'still should not be purgeable').to.be.false;
    });

    it('is purgeable', () => {
      entry.editingContexts.delete(context1);
      entry.editingContexts.delete(context2);
      expect(entry.isPurgeable, 'should be purgeable').to.be.true;
    });
  });

  describe('linking of entries', () => {
    let command3: Command;
    let command4: Command;

    let entry1: StackEntry;
    let entry2: StackEntry;
    let entry3: StackEntry;
    let entry4: StackEntry;

    beforeEach(() => {
      command3 = new TestCommand('c');
      command4 = new TestCommand('d');
      entry1 = new StackEntry(command1, [context1]);
      entry2 = new StackEntry(command2, [context2]);
      entry3 = new StackEntry(command3, [context1]);
      entry4 = new StackEntry(command4, [context2]);
      entry1.push(entry2);
    });

    it('can push next at end of the chain', () => {
      entry2.push(entry3);
      expect(entry2.next, 'wrong next').to.equal(entry3);
      expect(entry3.next, 'end of chain has a next').not.to.exist;
      expect(entry3.previous, 'end of chain has wrong previous').to.equal(
        entry2
      );
    });

    it('can insert within the chain', () => {
      entry1.push(entry4);
      expect(entry1.next, 'wrong next').to.equal(entry4);
      expect(entry4.next, 'inserted entry has wrong next').to.equal(entry2);
      expect(entry4.previous, 'inserted entry has wrong previous').to.equal(
        entry1
      );
      expect(entry2.previous, 'end of chain has wrong previous').to.equal(
        entry4
      );
    });

    describe('cycle detection', () => {
      it('cannot create a one-cycle', () => {
        expect(
          () => entry2.push(entry2),
          'should have thrown cycle precondition failure'
        ).to.throw();
      });

      it('cannot create an indirect cycle', () => {
        entry3.push(entry2);
        expect(
          () => entry2.push(entry3),
          'should have thrown cycle precondition failure'
        ).to.throw();
      });
    });

    it('can pop the end of the chain', () => {
      entry2.pop();
      expect(entry1.next, 'previous entry still references the popped entry')
        .not.to.exist;
      expect(entry2.previous, 'popped entry still references its previous').not
        .to.exist;
    });

    it('can pop from within the chain', () => {
      entry2.push(entry3);
      entry2.pop();
      expect(entry1.next, 'previous entry references wrong next').to.equal(
        entry3
      );
      expect(entry3.previous, 'next entry references wrong previous').to.equal(
        entry1
      );
      expect(entry2.next, 'popped entry still references its next').not.to
        .exist;
      expect(entry2.previous, 'popped entry still references its previous').not
        .to.exist;
    });

    describe('navigating editing context histories', () => {
      beforeEach(() => {
        entry2.push(entry3);
        entry3.push(entry4);
      });

      it('finds next in the editing context', () => {
        expect(entry1.nextIn(context1), 'wrong next in same context').to.equal(
          entry3
        );
        expect(
          entry1.nextIn(context2),
          'wrong next in different context'
        ).to.equal(entry2);
      });

      it('finds previous in the editing context', () => {
        expect(
          entry4.previousIn(context2),
          'wrong previous in same context'
        ).to.equal(entry2);
        expect(
          entry4.previousIn(context1),
          'wrong previous in different context'
        ).to.equal(entry3);
      });
    });
  });

  describe('editing context management', () => {
    let entry: StackEntry;

    beforeEach(() => {
      entry = new StackEntry(command1, [context1, context2]);
    });

    it('matches a context', () => {
      expect(entry.hasContext(context2), 'does not have the context').to.be
        .true;
    });

    it('does not match a context', () => {
      entry.editingContexts.delete(context2);
      expect(entry.hasContext(context2), 'has the context').to.be.false;
    });

    it('removes a context', () => {
      expect(entry.editingContexts, 'context not found').to.include(context2);
      entry.removeContext(context2);
      expect(entry.editingContexts, 'context still found').not.to.include(
        context2
      );
    });
  });

  describe('merge', () => {
    let entry1: StackEntry;
    let entry2: StackEntry;

    beforeEach(() => {
      entry1 = new StackEntry(command1, [context1]);
      entry2 = new StackEntry(command2, [context2]);
    });

    it('merges the editing contexts', () => {
      const merged = entry1.merge(entry2);
      expect(merged, 'wrong entry returned').to.equal(entry1);

      expect(merged.editingContexts, 'contexts not merged').to.include(
        context2
      );
      expect(merged.editingContexts, 'contexts removed').to.include(context1);
    });

    it('merges the commands', () => {
      const merged = entry1.merge(entry2);
      expect(merged, 'wrong entry returned').to.equal(entry1);

      expect(isCompoundCommand(merged.command), 'command is not a compound').to
        .be.true;

      const compound = merged.command as CompoundCommand;
      expect(compound.getCommands(), 'commands not merged').to.be.deep.equal([
        command1,
        command2,
      ]);
    });
  });
});

describe('AppendableCompoundCommand', () => {
  let command1: TestCommand;
  let command2: TestCommand;
  let compound: AppendableCompoundCommand;

  beforeEach(async () => {
    command1 = new TestCommand('a');
    command2 = new TestCommand('b');

    // Mark the commands executed as they would be in application scenarios
    await command1.execute();
    await command2.execute();

    compound = new AppendableCompoundCommand('test', command1);
  });

  it('is created in the executed state', () => {
    return expect(
      compound.canUndo(() => ({})),
      'command was not executed'
    ).to.eventually.be.true;
  });

  it('can be appended', () => {
    compound.append(command2);
    expect(compound.getCommands(), 'command not appended').to.include(command2);
  });

  it('cannot append when undone', async () => {
    await compound.undo(() => ({}));

    expect(
      () => compound.append(command2),
      'should have thrown precondition failure'
    ).to.throw();
  });

  describe('append() utility', () => {
    it('appends nothing', () => {
      const result = append(command2);
      expect(result, 'append should have been a no-op').to.equal(command2);
    });

    it('creates a new appendable compound', () => {
      const result = append(command1, command2);
      expect(result, 'wrong kind of compound').to.be.instanceOf(
        AppendableCompoundCommand
      );
      const asCompound = result as CompoundCommand;
      expect(
        asCompound.getCommands(),
        'wrong nested commands'
      ).to.be.deep.equal([command1, command2]);
    });

    it('appends to an existing compound', () => {
      const result = append(compound, command2);
      expect(result, 'wrong compound').to.be.equal(compound);
      expect(compound.getCommands(), 'wrong nested commands').to.be.deep.equal([
        command1,
        command2,
      ]);
    });
  });
});

describe('CoreCommandStackImpl', () => {
  const context1 = editingContext('test.c1');
  const context2 = editingContext('test.c2');
  let command1: TestCommand;
  let command2: TestCommand;
  let stack: CoreCommandStackImpl;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    command1 = new TestCommand('a');
    command2 = new TestCommand('b');
    stack = new CoreCommandStackImpl(workingCopyManager);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('With One EditingContext', () => {
    describe('execute', () => {
      it('executes a command', async () => {
        const delta = await stack.execute(command1, context1);

        expect(command1, 'command not executed').to.be.like({
          wasExecuted: true,
        });
        expect(delta, 'no delta returned').to.exist;
        expect(delta?.get(command1), 'bad delta returned').to.be.like([
          { op: 'add', path: 'a' },
        ]);
      });

      it('puts the command on the undo stack', async () => {
        await stack.execute(command1, context1);
        const undo = stack.getUndoCommand(context1);

        expect(undo, 'wrong undo command').to.equal(command1);

        await stack.execute(command2, context1);
        const undo2 = stack.getUndoCommand(context1);

        expect(undo2, 'wrong undo command').to.equal(command2);
      });

      it('requires an editing context', () => {
        return expect(
          stack.execute(command1),
          'should have thrown precondition failure'
        ).to.eventually.be.rejected;
      });

      it('flushes the redo stack', async () => {
        await stack.execute(command1, context1);
        await stack.execute(command2, context1);
        await stack.undo(context1);

        const newCommand = new TestCommand('c');
        await stack.execute(newCommand, context1);

        await expect(stack.canRedo(context1), 'redo stack not flushed').to
          .eventually.be.false;
        expect(stack.getRedoCommand(context1), 'redo command exists').not.to
          .exist;
      });
    });

    describe('undo', () => {
      beforeEach(async () => {
        await stack.execute(command1, context1);
        await stack.execute(command2, context1);
      });

      it('undoes a command', async () => {
        const delta = await stack.undo(context1);

        expect(command2, 'command not undone').to.be.like({ wasUndone: true });
        expect(delta, 'no delta returned').to.exist;
        expect(delta?.get(command2), 'bad delta returned').to.be.like([
          { op: 'remove', path: 'b' },
        ]);
      });

      it('puts the command on the redo stack', async () => {
        await stack.undo(context1);
        const redo = stack.getRedoCommand(context1);
        expect(redo, 'wrong redo command').to.equal(command2);

        await stack.undo(context1);
        const redo2 = stack.getRedoCommand(context1);
        expect(redo2, 'wrong redo command').to.equal(command1);
      });
    });

    describe('redo', () => {
      beforeEach(async () => {
        await stack.execute(command1, context1);
        await stack.execute(command2, context1);
        await stack.undo(context1);
        await stack.undo(context1);
      });

      it('redoes a command', async () => {
        const delta = await stack.redo(context1);

        expect(command1, 'command not redone').to.be.like({ wasRedone: true });
        expect(command2, 'command was redone').to.be.like({
          wasRedone: false,
          wasUndone: true,
        });
        expect(delta, 'no delta returned').to.exist;
        expect(delta?.get(command1), 'bad delta returned').to.be.like([
          { op: 'add', path: 'a' },
        ]);
      });

      it('puts the command on the undo stack', async () => {
        await stack.redo(context1);
        const undo = stack.getUndoCommand(context1);
        expect(undo, 'wrong undo command').to.equal(command1);

        await stack.redo(context1);
        const undo2 = stack.getUndoCommand(context1);
        expect(undo2, 'wrong undo command').to.equal(command2);
      });
    });

    describe('executeAndAppend', async () => {
      beforeEach(() => {
        return stack.execute(command1, context1);
      });

      it('executes a command', async () => {
        const delta = await stack.executeAndAppend(context1, command2);

        expect(command2, 'command not executed').to.be.like({
          wasExecuted: true,
        });
        expect(delta, 'no delta returned').to.exist;
        expect(delta?.get(command2), 'bad delta returned').to.be.like([
          { op: 'add', path: 'b' },
        ]);
      });

      it('undoes together with original command', async () => {
        await stack.executeAndAppend(context1, command2);
        const undo = stack.getUndoCommand(context1);

        expect(undo, 'wrong undo command').not.to.equal(command1);

        const delta = await stack.undo(context1);

        expect(delta, 'no delta returned').to.exist;
        expect(delta?.get(command2)).to.be.like([{ op: 'remove', path: 'b' }]);
        expect(delta?.get(command1)).to.be.like([{ op: 'remove', path: 'a' }]);
      });

      it('requires a command to append to', () => {
        return expect(
          stack.executeAndAppend(context2, command2, context1),
          'should have thrown precondition violation'
        ).to.eventually.be.rejected;
      });

      it('cannot append to an undone command', async () => {
        await stack.execute(command2, context1);
        await stack.undo(context1);

        await expect(
          stack.executeAndAppend(context1, command1),
          'should have thrown precondition violation'
        ).to.eventually.be.rejected;
      });

      it('cannot sneakily append to an undone command', async () => {
        await stack.executeAndAppend(context1, command2);
        await stack.undo(context1);

        const redo = stack.getRedoCommand(context1);
        expect(redo, 'no undo command').to.exist;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        expect(isCompoundCommand(redo!), 'undo command is not a compound').to.be
          .true;
        const compound = redo as CompoundCommand;

        expect(
          () => compound.append(new TestCommand('c')),
          'should have thrown precondition violation'
        ).to.throw();
      });

      it('can append to a redone command', async () => {
        await stack.undo(context1);
        await stack.redo(context1);

        const delta = stack.executeAndAppend(context1, command2);
        await expect(delta, 'no delta returned').to.eventually.exist;
      });

      it('can append again', async () => {
        await stack.executeAndAppend(context1, command2);
        const undo = stack.getUndoCommand(context1);

        const newCommand = new TestCommand('c');
        await stack.executeAndAppend(context1, newCommand);
        const undo2 = stack.getUndoCommand(context1);
        expect(undo2, 'wrong undo command').to.equal(undo);

        const delta = await stack.undo(context1);

        expect(delta, 'no delta returned').to.exist;
        expect(delta?.get(newCommand)).to.be.like([
          { op: 'remove', path: 'c' },
        ]);
        expect(delta?.get(command2)).to.be.like([{ op: 'remove', path: 'b' }]);
        expect(delta?.get(command1)).to.be.like([{ op: 'remove', path: 'a' }]);
      });

      describe('returns partial deltas when applicable', () => {
        const obtrudeResult = (cmd: Command, op: keyof Command) => {
          const stub = sandbox.stub(cmd, op).callsFake((...args) => {
            stub.wrappedMethod(...args);
            return undefined;
          });
        };

        beforeEach(async () => {
          sandbox.stub(workingCopyManager, 'isOpen').callsFake(() => false);
          await stack.executeAndAppend(context1, command2);
        });

        it('undo', () => {
          // Instrument the appended command to return no delta on undo
          obtrudeResult(command2, 'undo');

          return expect(
            stack.undo(context1),
            'a partial delta was not returned by undo'
          ).to.eventually.exist;
        });

        it('redo', async () => {
          await stack.undo(context1);

          // Instrument the appended command to return no delta on redo
          obtrudeResult(command2, 'redo');

          await expect(
            stack.redo(context1),
            'a partial delta was not returned by redo'
          ).to.eventually.exist;
        });
      });
    });

    describe('canExecute', () => {
      beforeEach(() => {
        sandbox.stub(workingCopyManager, 'isOpen').callsFake(() => false);
      });

      it('is executable', () => {
        return expect(stack.canExecute(command1, context1), 'cannot execute').to
          .eventually.be.true;
      });

      it('is not executable by reason of the command', async () => {
        await expect(stack.canExecute(command1, context1), 'cannot execute').to
          .eventually.be.true;

        await stack.execute(command1, context1);

        await expect(stack.canExecute(command1, context1), 'can still execute')
          .to.eventually.be.false;
      });

      it('is not executable by reason of the contexts', async () => {
        await expect(stack.canExecute(command1), 'can execute').to.eventually.be
          .false;
      });
    });

    describe('canUndo', () => {
      beforeEach(async () => {
        await stack.execute(command1, context1);
        await stack.execute(command2, context1);
      });

      it('is undoable', () => {
        return expect(stack.canUndo(context1), 'cannot undo').to.eventually.be
          .true;
      });

      it('is not undoable by reason of itself', async () => {
        await stack.undo(context1);

        await expect(stack.canUndo(context1), 'cannot undo').to.eventually.be
          .true;

        await stack.undo(context1);

        await expect(stack.canUndo(context1), 'can still undo').to.eventually.be
          .false;
      });

      it('is not undoable by reason of the command', async () => {
        // Undo the next command, thus making it non-undoable
        await command2.undo();

        await expect(stack.canUndo(context1), 'can undo').to.eventually.be
          .false;
      });
    });

    describe('canRedo', () => {
      beforeEach(async () => {
        await stack.execute(command1, context1);
        await stack.execute(command2, context1);
        await stack.undo(context1);
        await stack.undo(context1);
      });

      it('is redoable', () => {
        return expect(stack.canRedo(context1), 'cannot redo').to.eventually.be
          .true;
      });

      it('is not redoable by reason of itself', async () => {
        await stack.redo(context1);

        await expect(stack.canRedo(context1), 'cannot redo').to.eventually.be
          .true;

        await stack.redo(context1);

        await expect(stack.canRedo(context1), 'can still redo').to.eventually.be
          .false;
      });

      it('is not redoable by reason of the command', async () => {
        // Redo the next command, thus making it non-redoable
        await command1.redo();

        await expect(stack.canRedo(context1), 'can redo').to.eventually.be
          .false;
      });
    });

    describe('getUndoCommand', () => {
      beforeEach(async () => {
        await stack.execute(command1, context1);
        await stack.execute(command2, context1);
      });

      it('is the next undo command', async () => {
        const undo = stack.getUndoCommand(context1);

        expect(undo, 'wrong undo command').to.be.equal(command2);

        await stack.undo(context1);

        const undo2 = stack.getUndoCommand(context1);

        expect(undo2, 'wrong undo command').to.be.equal(command1);
      });

      it('is undefined', async () => {
        await stack.undo(context1);
        await stack.undo(context1);

        const undo = stack.getUndoCommand(context1);
        expect(undo, 'got an undo command').not.to.exist;
      });
    });

    describe('getRedoCommand', () => {
      beforeEach(async () => {
        await stack.execute(command1, context1);
        await stack.execute(command2, context1);
        await stack.undo(context1);
        await stack.undo(context1);
      });

      it('is the next redo command', async () => {
        const redo = stack.getRedoCommand(context1);

        expect(redo, 'wrong redo command').to.be.equal(command1);

        await stack.redo(context1);

        const redo2 = stack.getRedoCommand(context1);

        expect(redo2, 'wrong redo command').to.be.equal(command2);
      });

      it('is undefined', async () => {
        await stack.redo(context1);
        await stack.redo(context1);

        const redo = stack.getRedoCommand(context1);
        expect(redo, 'got a redo command').not.to.exist;
      });
    });

    describe('flush', () => {
      beforeEach(async () => {
        // We have commands on the undo stack and on the redo stack
        await stack.execute(command1, context1);
        await stack.execute(command2, context1);
        await stack.undo(context1);
      });

      it('clears the redo stack', () => {
        stack.flush(context1);

        const redo = stack.getRedoCommand(context1);
        expect(redo, 'got a redo command').not.to.exist;
      });

      it('clears the undo stack', () => {
        stack.flush(context1);

        const undo = stack.getUndoCommand(context1);
        expect(undo, 'got an undo command').not.to.exist;
      });

      it('returns purged commands', () => {
        const purged = stack.flush(context1);

        expect(purged).to.be.an('array').of.length(2);
        expect(purged).to.include(command1).and.to.include(command2);
      });

      it('empties the stack', () => {
        stack.flush(context1);

        expect(stack).to.be.like({
          _top: undefined,
          _undoEntries: new Map(),
          _redoEntries: new Map(),
        });
      });
    });
  });

  describe('With Multiple EditingContexts', () => {
    beforeEach(() => {
      command1 = new TestCommand('a');
      command2 = new TestCommand('b');
      stack = new CoreCommandStackImpl(workingCopyManager);
    });

    describe('execute', () => {
      it('executes a command', async () => {
        await stack.execute(command1, context1, context2);

        expect(command1, 'command not executed').to.be.like({
          wasExecuted: true,
        });
      });

      it('puts the command on the undo stack of all contexts', async () => {
        await stack.execute(command1, context1, context2);

        const undo1 = stack.getUndoCommand(context1);
        expect(undo1, 'wrong undo command').to.equal(command1);

        const undo2 = stack.getUndoCommand(context2);
        expect(undo2, 'wrong undo command').to.equal(command1);
      });

      it('flushes all redo stacks', async () => {
        await stack.execute(command1, context1);
        await stack.execute(command2, context1, context2);
        await stack.undo(context1);

        const newCommand = new TestCommand('c');
        await stack.execute(newCommand, context1, context2);

        await expect(
          stack.canRedo(context1),
          'redo stack of context 1 not flushed'
        ).to.eventually.be.false;
        await expect(
          stack.canRedo(context2),
          'redo stack of context 2 not flushed'
        ).to.eventually.be.false;
        expect(
          stack.getRedoCommand(context1),
          'redo command exists in context 1'
        ).not.to.exist;
        expect(
          stack.getRedoCommand(context2),
          'redo command exists in context 2'
        ).not.to.exist;
      });

      it('flushes one redo stack with dependencies', async () => {
        await stack.execute(command1, context1);
        await stack.execute(command2, context1, context2);
        await stack.execute(new TestCommand('c'), context2);
        await stack.undo(context2);
        await stack.undo(context1);

        const newCommand = new TestCommand('d');
        await stack.execute(newCommand, context1);

        await expect(
          stack.canRedo(context1),
          'redo stack of context 1 not flushed'
        ).to.eventually.be.false;
        await expect(
          stack.canRedo(context2),
          'redo stack of context 2 was not also flushed for dependencies'
        ).to.eventually.be.false;
        expect(
          stack.getRedoCommand(context1),
          'redo command exists in context 1'
        ).not.to.exist;
        expect(
          stack.getRedoCommand(context2),
          'redo command exists in context 2'
        ).not.to.exist;

        expect(stack, 'commands not purged as expected').to.be.like({
          _top: {
            _command: newCommand,
            _previous: {
              _command: command1,
            },
          },
        });
        expect(
          (stack['_top'] as StackEntry).previous?.previous,
          'too much on the stack'
        ).not.to.exist;
      });

      it('flushes portion of one redo stack in common with another', async () => {
        await stack.execute(command1, context1);
        await stack.execute(command2, context1, context2);
        await stack.undo(context2);
        await stack.undo(context1);

        const newCommand = new TestCommand('c');
        await stack.execute(newCommand, context2);

        await expect(
          stack.canRedo(context2),
          'redo stack of context 2 not flushed'
        ).to.eventually.be.false;
        await expect(
          stack.canRedo(context1),
          'redo stack of context 1 was flushed too much'
        ).to.eventually.be.true;
        expect(
          stack.getRedoCommand(context1),
          'wrong redo command in context 1'
        ).to.equal(command1);
      });
    });

    describe('command stack notifications', () => {
      it('on execute', async () => {
        const callback = sandbox.stub();
        const sub = stack.subscribe();
        sub.onContextChanged = callback;

        await stack.execute(command1, context1);
        await stack.execute(command2, context1, context2);

        expect(callback).to.have.been.calledThrice;
        expect(callback).to.have.been.calledWith(
          context1,
          'executed',
          command1
        );
        expect(callback).to.have.been.calledWith(
          context1,
          'executed',
          command2
        );
        expect(callback).to.have.been.calledWith(
          context2,
          'executed',
          command2
        );
      });

      it('on undo', async () => {
        await stack.execute(command1, context1);
        await stack.execute(command2, context1, context2);

        const callback = sandbox.stub();
        const sub = stack.subscribe();
        sub.onContextChanged = callback;

        await stack.undo(context1);

        expect(callback).to.have.been.calledTwice;
        expect(callback).to.have.been.calledWith(context1, 'undone', command2);
        expect(callback).to.have.been.calledWith(context2, 'undone', command2);
      });

      it('on redo', async () => {
        await stack.execute(command1, context1);
        await stack.execute(command2, context1, context2);
        await stack.undo(context1);

        const callback = sandbox.stub();
        const sub = stack.subscribe();
        sub.onContextChanged = callback;

        await stack.redo(context1);

        expect(callback).to.have.been.calledTwice;
        expect(callback).to.have.been.calledWith(context1, 'redone', command2);
        expect(callback).to.have.been.calledWith(context2, 'redone', command2);
      });

      it('close', async () => {
        const callback = sandbox.stub();
        const sub = stack.subscribe();
        sub.onContextChanged = callback;

        await stack.execute(command1, context1);
        sub.close();

        await stack.undo(context1);
        await stack.redo(context1);

        expect(callback).to.have.been.calledOnce;
        expect(callback).to.have.been.calledWith(
          context1,
          'executed',
          command1
        );
        callback.resetHistory();

        // Closing again is idempotent
        sub.close();

        await stack.execute(command2, context1);
        expect(callback).not.to.have.been.called;
      });

      it('multiple subs', async () => {
        const callback1 = sandbox.stub();
        const sub1 = stack.subscribe(context1);
        sub1.onContextChanged = callback1;
        const callback2 = sandbox.stub();
        const sub2 = stack.subscribe(context1);
        sub2.onContextChanged = callback2;

        await stack.execute(command1, context1);
        sub1.close();

        await stack.undo(context1);

        expect(callback1).to.have.been.calledOnce;
        expect(callback2).to.have.been.calledTwice;
        expect(callback1).to.have.been.calledWith(
          context1,
          'executed',
          command1
        );
        expect(callback2).to.have.been.calledWith(
          context1,
          'executed',
          command1
        );
        expect(callback2).to.have.been.calledWith(context1, 'undone', command1);
      });
    });

    describe('getEditingContexts', () => {
      it('contexts that have been edited', async () => {
        let editingContexts = stack.getEditingContexts();
        expect(editingContexts, 'should have no editing contexts').to.be.empty;

        await stack.execute(command1, context1);
        editingContexts = stack.getEditingContexts();
        expect(editingContexts, 'should have exactly context 1')
          .to.be.include(context1)
          .and.have.length(1);

        await stack.execute(command2, context2);
        editingContexts = stack.getEditingContexts();
        expect(editingContexts, 'should additionally have context 2')
          .to.be.include(context2)
          .and.have.length(2);

        await stack.undo(context2);
        await stack.undo(context1);

        editingContexts = stack.getEditingContexts();
        expect(editingContexts, 'should have exactly context1 and context2')
          .to.have.members([context1, context2])
          .and.have.length(2);
      });

      it('flushed but dirty context', async () => {
        await stack.execute(command1, context1);

        stack.markSaved(context1);

        // Make context1 dirty
        await stack.execute(command2, context1, context2);

        // Flush it
        stack.flush(context1);

        const editingContexts = stack.getEditingContexts();
        expect(editingContexts, 'should have exactly context1 and context2')
          .to.have.members([context1, context2])
          .and.have.length(2);
      });

      it('flushed and saved context', async () => {
        await stack.execute(command2, context1, context2);

        // Flush context 1
        stack.flush(context1);

        // Save it
        stack.markSaved(context1);

        const editingContexts = stack.getEditingContexts();
        expect(editingContexts, 'should not have context1').not.to.include(
          context1
        );
        expect(editingContexts, 'missing context2').to.include(context2);
      });
    });

    describe('undo', () => {
      beforeEach(async () => {
        await stack.execute(command1, context1);
        await stack.execute(command2, context1, context2);
      });

      it('undoes a command in context1', async () => {
        await stack.undo(context1);

        expect(command2, 'command not undone').to.be.like({ wasUndone: true });

        await expect(stack.canUndo(context1), 'cannot undo context1 again').to
          .eventually.be.true;

        await expect(stack.canUndo(context2), 'can undo context2 again').to
          .eventually.be.false;
      });

      it('undoes a command in context2', async () => {
        await stack.undo(context2);

        expect(command2, 'command not undone').to.be.like({ wasUndone: true });

        await expect(stack.canUndo(context1), 'cannot undo context1 again').to
          .eventually.be.true;

        await expect(stack.canUndo(context2), 'can undo context2 again').to
          .eventually.be.false;
      });

      it('puts the command on all redo stacks', async () => {
        await stack.undo(context1);

        const redo1 = stack.getRedoCommand(context1);
        expect(redo1, 'wrong redo command').to.equal(command2);

        const redo2 = stack.getRedoCommand(context2);
        expect(redo2, 'wrong redo command').to.equal(command2);
      });

      it('notifies', async () => {
        const callback = sandbox.stub();
        const sub = stack.subscribe();
        sub.onContextChanged = callback;

        await stack.undo(context2);
        await stack.undo(context1);

        expect(callback).to.have.been.calledThrice;
        expect(callback).to.have.been.calledWith(context2, 'undone', command2);
        expect(callback).to.have.been.calledWith(context1, 'undone', command2);
        expect(callback).to.have.been.calledWith(context1, 'undone', command1);
      });
    });

    describe('undo dependencies', () => {
      beforeEach(async () => {
        await stack.execute(command1, context1, context2);
        await stack.execute(command2, context1);
      });

      it('cannot undo a command that is not next in all its contexts', async () => {
        // Should always be able to undo the last command in the temporal order
        await expect(stack.canUndo(context1, false), 'cannot undo last command')
          .to.eventually.be.true;

        // But this one needs the other context to have undone first
        await expect(
          stack.canUndo(context2, false),
          'can undo dependent command'
        ).to.eventually.be.false;
      });

      it('throws on violated dependency precondition', () => {
        return expect(
          stack.undo(context2, false),
          'should have thrown precondition failure'
        ).to.eventually.be.rejected;
      });

      it('analyze undo without undo command', async () => {
        const analysis = await stack.analyzeUndo('no-such-context');
        expect(analysis.canUndo, 'can undo').to.be.false;
        expect(analysis.hasDependencies, 'should not have dependencies').to.be
          .false;
        expect(analysis.summary).to.equal(
          "There is no command to undo in context 'no-such-context'."
        );
        expect(analysis.contexts).to.deep.equal({ 'no-such-context': false });
      });

      it('analyze undo without dependencies', async () => {
        const analysis = await stack.analyzeUndo(context1);
        expect(analysis.canUndo, 'cannot undo without dependencies').to.be.true;
        expect(analysis.hasDependencies, 'should not have dependencies').to.be
          .false;
        expect(analysis.summary).to.match(
          /^The undo command .* is undoable\.$/
        );
        expect(analysis.contexts).to.deep.equal({ [context1]: true });
      });

      it('analyze undo without dependencies - not undoable', async () => {
        sandbox.stub(command2, 'canUndo').returns(Promise.resolve(false));

        const analysis = await stack.analyzeUndo(context1);
        expect(analysis.canUndo, 'can undo without dependencies').to.be.false;
        expect(analysis.hasDependencies, 'should not have dependencies').to.be
          .false;
        expect(analysis.summary).to.match(
          /^The undo command .* is not undoable\.$/
        );
        expect(analysis.contexts).to.deep.equal({ [context1]: false });
      });

      it('analyze undo with dependencies', async () => {
        const analysis = await stack.analyzeUndo(context2);
        expect(analysis.canUndo, 'cannot undo dependencies').to.be.true;
        expect(analysis.hasDependencies, 'should have dependencies').to.be.true;
        expect(analysis.summary).to.match(
          /^The undo command .* is undoable\.$/
        );
        expect(analysis.contexts).to.exist;
        expect(analysis.contexts).to.be.like({
          [context1]: true,
          [context2]: true,
        });
      });

      it('analyze undo with dependencies - not undoable', async () => {
        sandbox.stub(command1, 'canUndo').returns(Promise.resolve(false));

        const analysis = await stack.analyzeUndo(context2);
        expect(analysis.canUndo, 'can undo').to.be.false;
        expect(analysis.hasDependencies, 'should have dependencies').to.be.true;
        expect(analysis.summary).to.match(
          /^The undo command .* because it is not itself undoable\.$/
        );
        expect(analysis.contexts).to.exist;
        expect(analysis.contexts).to.be.like({
          [context1]: true,
          [context2]: false,
        });
      });

      it('analyze undo with dependencies - dependency not undoable', async () => {
        sandbox.stub(command2, 'canUndo').returns(Promise.resolve(false));

        const analysis = await stack.analyzeUndo(context2);
        expect(analysis.canUndo, 'can undo').to.be.false;
        expect(analysis.hasDependencies, 'should have dependencies').to.be.true;
        expect(analysis.summary).to.match(
          /^The undo command .* is not undoable because its dependency '.*' is not undoable\.$/
        );
        expect(analysis.contexts).to.exist;
        expect(analysis.contexts).to.be.like({
          [context1]: false,
          [context2]: true,
        });
      });

      it('analyze undo with dependencies - it and a dependency not undoable', async () => {
        sandbox.stub(command2, 'canUndo').returns(Promise.resolve(false));
        sandbox.stub(command1, 'canUndo').returns(Promise.resolve(false));

        const analysis = await stack.analyzeUndo(context2);
        expect(analysis.canUndo, 'can undo').to.be.false;
        expect(analysis.hasDependencies, 'should have dependencies').to.be.true;
        expect(analysis.summary).to.match(
          /^The undo command .* is not undoable because it is not itself undoable and its dependency '.*' is not undoable\.$/
        );
        expect(analysis.contexts).to.exist;
        expect(analysis.contexts).to.be.like({
          [context1]: false,
          [context2]: false,
        });
      });

      it('analyze undo with dependencies - multiple dependencies not undoable', async () => {
        stack.flush(context1);
        stack.flush(context2);
        const context3 = editingContext('new.context');
        command1 = new TestCommand('a');
        command2 = new TestCommand('b');
        const command3 = new TestCommand('c');

        await stack.execute(command1, context1, context3);
        await stack.execute(command2, context1, context2);
        await stack.execute(command3, context1);

        sandbox.stub(command2, 'canUndo').returns(Promise.resolve(false));
        sandbox.stub(command3, 'canUndo').returns(Promise.resolve(false));

        const analysis = await stack.analyzeUndo(context3);
        expect(analysis.canUndo, 'can undo').to.be.false;
        expect(analysis.hasDependencies, 'should have dependencies').to.be.true;
        expect(analysis.summary).to.match(
          /^The undo command .* is not undoable because its dependencies '.*' are not undoable\.$/
        );
        expect(analysis.contexts).to.exist;
        expect(analysis.contexts).to.be.like({
          [context1]: false,
          [context2]: false,
          [context3]: true,
        });
      });

      it('undoes and then redoes dependencies as a unit', async () => {
        const undoCommand1 = sandbox
          .spy(command1, 'undo')
          .named('undo command1');
        const undoCommand2 = sandbox
          .spy(command2, 'undo')
          .named('undo command2');
        const redoCommand1 = sandbox
          .spy(command1, 'redo')
          .named('redo command1');
        const redoCommand2 = sandbox
          .spy(command2, 'redo')
          .named('redo command2');

        await expect(
          stack.canUndo(context2),
          'should be able to undo with dependencies'
        ).to.eventually.be.true;

        await expect(
          stack.undo(context2),
          'should not have thrown precondition failure'
        ).to.eventually.be.fulfilled;

        expect(command1.wasUndone).to.be.true;
        expect(command2.wasUndone).to.be.true;

        sinon.assert.callOrder(undoCommand2, undoCommand1);

        // Then redoing either context on its own is trivial (no dependencies)
        await expect(stack.canRedo(context1, false)).to.eventually.be.true;
        await expect(stack.canRedo(context2, false)).to.eventually.be.true;

        await expect(stack.redo(context2, false)).to.eventually.be.fulfilled;
        expect(command1.wasRedone).to.be.true;
        expect(command2.wasRedone).to.be.true;

        sinon.assert.callOrder(redoCommand1, redoCommand2);
      });
    });

    describe('redo', () => {
      beforeEach(async () => {
        await stack.execute(command1, context1, context2);
        await stack.execute(command2, context1);
        await stack.undo(context1);
        await stack.undo(context1);
      });

      it('redoes a command in context1', async () => {
        await stack.redo(context1);

        expect(command1, 'command not redone').to.be.like({ wasRedone: true });

        await expect(stack.canRedo(context1), 'cannot redo context1 again').to
          .eventually.be.true;

        await expect(stack.canRedo(context2), 'can redo context2 again').to
          .eventually.be.false;
      });

      it('redoes a command in context2', async () => {
        await stack.redo(context2);

        expect(command1, 'command not redone').to.be.like({ wasRedone: true });

        await expect(stack.canRedo(context1), 'cannot redo context1 again').to
          .eventually.be.true;

        await expect(stack.canRedo(context2), 'can redo context2 again').to
          .eventually.be.false;
      });

      it('puts the command on all undo stacks', async () => {
        await stack.redo(context1);

        const undo1 = stack.getUndoCommand(context1);
        expect(undo1, 'wrong undo command').to.equal(command1);

        const undo2 = stack.getUndoCommand(context2);
        expect(undo2, 'wrong undo command').to.equal(command1);
      });

      it('notifies', async () => {
        const callback = sandbox.stub();
        const sub = stack.subscribe();
        sub.onContextChanged = callback;

        await stack.redo(context2);
        await stack.redo(context1);

        expect(callback).to.have.been.calledThrice;
        expect(callback).to.have.been.calledWith(context1, 'redone', command1);
        expect(callback).to.have.been.calledWith(context2, 'redone', command1);
        expect(callback).to.have.been.calledWith(context1, 'redone', command2);
      });
    });

    describe('redo dependencies', () => {
      beforeEach(async () => {
        await stack.execute(command1, context1);
        await stack.execute(command2, context1, context2);
        await stack.undo(context1);
        await stack.undo(context1);
      });

      it('cannot redo a command that is not next in all its contexts', async () => {
        await expect(stack.canRedo(context1, false), 'cannot redo context1').to
          .eventually.be.true;

        // But this one needs the other context to have redone first
        await expect(
          stack.canRedo(context2, false),
          'can redo dependent command'
        ).to.eventually.be.false;
      });

      it('throws on violated dependency precondition', () => {
        return expect(
          stack.redo(context2, false),
          'should have thrown precondition failure'
        ).to.eventually.be.rejected;
      });

      it('analyze redo without redo command', async () => {
        const analysis = await stack.analyzeRedo('no-such-context');
        expect(analysis.canRedo, 'can redo').to.be.false;
        expect(analysis.hasDependencies, 'should not have dependencies').to.be
          .false;
        expect(analysis.summary).to.equal(
          "There is no command to redo in context 'no-such-context'."
        );
        expect(analysis.contexts).to.deep.equal({ 'no-such-context': false });
      });

      it('analyze redo without dependencies', async () => {
        const analysis = await stack.analyzeRedo(context1);
        expect(analysis.canRedo, 'cannot redo without dependencies').to.be.true;
        expect(analysis.hasDependencies, 'should not have dependencies').to.be
          .false;
        expect(analysis.summary).to.match(
          /^The redo command .* is redoable\.$/
        );
        expect(analysis.contexts).to.deep.equal({ [context1]: true });
      });

      it('analyze redo without dependencies - not redoable', async () => {
        sandbox.stub(command1, 'canRedo').returns(Promise.resolve(false));

        const analysis = await stack.analyzeRedo(context1);
        expect(analysis.canRedo, 'can redo without dependencies').to.be.false;
        expect(analysis.hasDependencies, 'should not have dependencies').to.be
          .false;
        expect(analysis.summary).to.match(
          /^The redo command .* is not redoable\.$/
        );
        expect(analysis.contexts).to.deep.equal({ [context1]: false });
      });

      it('analyze redo with dependencies', async () => {
        const analysis = await stack.analyzeRedo(context2);
        expect(analysis.canRedo, 'cannot redo dependencies').to.be.true;
        expect(analysis.hasDependencies, 'should have dependencies').to.be.true;
        expect(analysis.summary).to.match(
          /^The redo command .* is redoable\.$/
        );
        expect(analysis.contexts).to.exist;
        expect(analysis.contexts).to.be.like({
          [context1]: true,
          [context2]: true,
        });
      });

      it('analyze redo with dependencies - not redoable', async () => {
        sandbox.stub(command2, 'canRedo').returns(Promise.resolve(false));

        const analysis = await stack.analyzeRedo(context2);
        expect(analysis.canRedo, 'can redo').to.be.false;
        expect(analysis.hasDependencies, 'should have dependencies').to.be.true;
        expect(analysis.summary).to.match(
          /^The redo command .* because it is not itself redoable\.$/
        );
        expect(analysis.contexts).to.exist;
        expect(analysis.contexts).to.be.like({
          [context1]: true,
          [context2]: false,
        });
      });

      it('analyze redo with dependencies - dependency not redoable', async () => {
        sandbox.stub(command1, 'canRedo').returns(Promise.resolve(false));

        const analysis = await stack.analyzeRedo(context2);
        expect(analysis.canRedo, 'can redo').to.be.false;
        expect(analysis.hasDependencies, 'should have dependencies').to.be.true;
        expect(analysis.summary).to.match(
          /^The redo command .* is not redoable because its dependency '.*' is not redoable\.$/
        );
        expect(analysis.contexts).to.exist;
        expect(analysis.contexts).to.be.like({
          [context1]: false,
          [context2]: true,
        });
      });

      it('analyze redo with dependencies - it and a dependency not redoable', async () => {
        sandbox.stub(command1, 'canRedo').returns(Promise.resolve(false));
        sandbox.stub(command2, 'canRedo').returns(Promise.resolve(false));

        const analysis = await stack.analyzeRedo(context2);
        expect(analysis.canRedo, 'can redo').to.be.false;
        expect(analysis.hasDependencies, 'should have dependencies').to.be.true;
        expect(analysis.summary).to.match(
          /^The redo command .* is not redoable because it is not itself redoable and its dependency '.*' is not redoable\.$/
        );
        expect(analysis.contexts).to.exist;
        expect(analysis.contexts).to.be.like({
          [context1]: false,
          [context2]: false,
        });
      });

      it('analyze redo with dependencies - multiple dependencies not redoable', async () => {
        stack.flush(context1);
        stack.flush(context2);
        const context3 = editingContext('new.context');
        command1 = new TestCommand('a');
        command2 = new TestCommand('b');
        const command3 = new TestCommand('c');

        await stack.execute(command1, context1);
        await stack.execute(command2, context1, context2);
        await stack.execute(command3, context1, context3);

        await stack.undo(context1);
        await stack.undo(context1);
        await stack.undo(context1);

        sandbox.stub(command1, 'canRedo').returns(Promise.resolve(false));
        sandbox.stub(command2, 'canRedo').returns(Promise.resolve(false));

        const analysis = await stack.analyzeRedo(context3);
        expect(analysis.canRedo, 'can redo').to.be.false;
        expect(analysis.hasDependencies, 'should have dependencies').to.be.true;
        expect(analysis.summary).to.match(
          /^The redo command .* is not redoable because its dependencies '.*' are not redoable\.$/
        );
        expect(analysis.contexts).to.exist;
        expect(analysis.contexts).to.be.like({
          [context1]: false,
          [context2]: false,
          [context3]: true,
        });
      });

      it('redoes and then undoes dependencies as a unit', async () => {
        const redoCommand1 = sandbox
          .spy(command1, 'redo')
          .named('redo command1');
        const redoCommand2 = sandbox
          .spy(command2, 'redo')
          .named('redo command2');
        const undoCommand1 = sandbox
          .spy(command1, 'undo')
          .named('undo command1');
        const undoCommand2 = sandbox
          .spy(command2, 'undo')
          .named('undo command2');

        await expect(
          stack.canRedo(context2),
          'should be able to redo with dependencies'
        ).to.eventually.be.true;

        await expect(
          stack.redo(context2),
          'should not have thrown precondition failure'
        ).to.eventually.be.fulfilled;

        expect(command1.wasRedone).to.be.true;
        expect(command2.wasRedone).to.be.true;

        sinon.assert.callOrder(redoCommand1, redoCommand2);

        // Then undoing either context on its own is trivial (no dependencies)
        await expect(stack.canUndo(context1, false)).to.eventually.be.true;
        await expect(stack.canUndo(context2, false)).to.eventually.be.true;

        await expect(stack.undo(context2, false)).to.eventually.be.fulfilled;

        sinon.assert.callOrder(undoCommand2, undoCommand1);
      });
    });

    describe('executeAndAppend', () => {
      beforeEach(() => {
        return stack.execute(command1, context1);
      });

      it('adds contexts', async () => {
        await stack.executeAndAppend(context1, command2, context2);

        expect(command2, 'command not executed').to.be.like({
          wasExecuted: true,
        });

        const undo1 = stack.getUndoCommand(context1);
        expect(undo1, "command's original context lost").to.exist;
        expect(undo1, 'command should have been composed').not.to.equal(
          command1
        );

        const undo2 = stack.getUndoCommand(context2);
        expect(undo2, 'context not added to command').to.be.equal(undo1);

        expect(undo2, 'contexts have different undo commands').to.be.equal(
          undo1
        );
      });

      it('no problem to repeat contexts', async () => {
        await stack.executeAndAppend(context1, command2, context2, context1);

        expect(command2, 'command not executed').to.be.like({
          wasExecuted: true,
        });

        const undo1 = stack.getUndoCommand(context1);
        expect(undo1, "command's original context lost").to.exist;

        const undo2 = stack.getUndoCommand(context2);
        expect(undo2, 'context not added to command').to.be.equal(undo1);
      });

      it('notifies', async () => {
        const callback = sandbox.stub();
        const sub = stack.subscribe();
        sub.onContextChanged = callback;

        await stack.executeAndAppend(context1, command2, context2);

        expect(callback).to.have.been.calledTwice;
        expect(callback).to.have.been.calledWith(
          context1,
          'executed',
          command2
        );
        expect(callback).to.have.been.calledWith(
          context2,
          'executed',
          command2
        );
      });
    });

    describe('flush', () => {
      beforeEach(async () => {
        // We have commands on the undo stack and on the redo stack
        await stack.execute(command1, context1, context2);
        await stack.execute(command2, context1, context2);
        await stack.undo(context1);
      });

      it('clears the redo stack for flushed context', () => {
        stack.flush(context1);

        const redo = stack.getRedoCommand(context1);
        expect(redo, 'got a redo command').not.to.exist;
      });

      it('retains unflushed redo stack', () => {
        stack.flush(context1);

        const redo = stack.getRedoCommand(context2);
        expect(redo, 'wrong redo command for context 2').to.equal(command2);
      });

      it('clears the undo stack for flushed context', () => {
        stack.flush(context1);

        const undo = stack.getUndoCommand(context1);
        expect(undo, 'got an undo command').not.to.exist;
      });

      it('retains unflushed undo stack', () => {
        stack.flush(context1);

        const undo = stack.getUndoCommand(context2);
        expect(undo, 'wrong undo command for context 2').to.equal(command1);
      });

      it('does not purge commands that still have contexts', () => {
        const purged = stack.flush(context1);

        expect(purged).to.be.an('array').of.length(0);
      });

      it('returns purged commands', () => {
        stack.flush(context1);
        const purged = stack.flush(context2);

        expect(purged).to.be.an('array').of.length(2);
        expect(purged).to.include(command1).and.to.include(command2);
      });

      it('empties the stack when all contexts flushed', () => {
        stack.flush(context1);
        stack.flush(context2);

        expect(stack).to.be.like({
          _top: undefined,
          _undoEntries: new Map(),
          _redoEntries: new Map(),
        });
      });

      it('notifies', () => {
        const callback = sandbox.stub();
        const sub = stack.subscribe();
        sub.onContextChanged = callback;

        stack.flush(context2);
        stack.flush(context1);

        expect(callback).to.have.been.calledTwice;
        expect(callback).to.have.been.calledWithExactly(context2, 'flushed');
        expect(callback).to.have.been.calledWithExactly(context1, 'flushed');
      });
    });

    describe('independent contexts', () => {
      beforeEach(async () => {
        await stack.execute(command1, context1);
        await stack.execute(command2, context2);
      });

      it('executes, undoes, and redoes separately', async () => {
        await expect(stack.canUndo(context1), 'cannot undo context 1').to
          .eventually.be.true;
        await expect(stack.canUndo(context2), 'cannot undo context 2').to
          .eventually.be.true;

        // Can undo the command that was executed first because
        // it doesn't share a context with the second command
        await stack.undo(context1);
        await expect(stack.canUndo(context1), 'can undo context 1 again').to
          .eventually.be.false;
        await expect(stack.canRedo(context1), 'cannot undo context 2').to
          .eventually.be.true;

        await stack.undo(context2);
        await expect(stack.canUndo(context2), 'can undo context 2 again').to
          .eventually.be.false;
        await expect(stack.canRedo(context2), 'cannot redo context 2').to
          .eventually.be.true;

        await stack.redo(context1);
        await stack.redo(context2);

        expect(command1, 'command 1 not redone').to.be.like({
          wasRedone: true,
        });
        expect(command2, 'command 2 not redone').to.be.like({
          wasRedone: true,
        });
      });

      it('flushes undo context 1', async () => {
        stack.flush(context1);

        await expect(stack.canUndo(context1), 'context 1 still exists').to
          .eventually.be.false;
        await expect(stack.canUndo(context2), 'context 2 was flushed').to
          .eventually.be.true;

        await stack.undo(context2);

        await expect(
          stack.undo(context1),
          'should not have been able to undo context 1'
        ).to.eventually.be.rejected;
      });

      it('flushes undo context 2', async () => {
        stack.flush(context2);

        await expect(stack.canUndo(context2), 'context 2 still exists').to
          .eventually.be.false;
        await expect(stack.canUndo(context1), 'context 1 was flushed').to
          .eventually.be.true;

        await stack.undo(context1);

        await expect(
          stack.undo(context2),
          'should not have been able to undo context 2'
        ).to.eventually.be.rejected;
      });

      it('flushes redo context 1', async () => {
        await stack.undo(context1);
        await stack.undo(context2);
        stack.flush(context1);

        await expect(stack.canRedo(context1), 'context 1 still exists').to
          .eventually.be.false;
        await expect(stack.canRedo(context2), 'context 2 was flushed').to
          .eventually.be.true;

        await stack.redo(context2);

        await expect(
          stack.redo(context1),
          'should not have been able to redo context 1'
        ).to.eventually.be.rejected;
      });

      it('flushes redo context 2', async () => {
        await stack.undo(context1);
        await stack.undo(context2);
        stack.flush(context2);

        await expect(stack.canRedo(context2), 'context 2 still exists').to
          .eventually.be.false;
        await expect(stack.canRedo(context1), 'context 1 was flushed').to
          .eventually.be.true;

        await stack.redo(context1);

        await expect(
          stack.redo(context2),
          'should not have been able to redo context 2'
        ).to.eventually.be.rejected;
      });
    });

    describe('dirty state', () => {
      it('no dirty models initially', () => {
        expect(stack.isDirty(context1)).to.be.false;
        expect(stack.getDirtyModelIds(context1)).to.be.eql([]);
      });

      it('execute makes dirty', async () => {
        await stack.execute(new TestCommand('edit A', 'modelA'), context1);
        await stack.execute(new TestCommand('edit B', 'modelB'), context2);
        expect(stack.isDirty(context1)).to.be.true;
        let dirtyModels = stack.getDirtyModelIds(context1);
        expect(dirtyModels).to.be.eql(['modelA']);
        expect(stack.isDirty(context2)).to.be.true;
        dirtyModels = stack.getDirtyModelIds(context2);
        expect(dirtyModels).to.be.eql(['modelB']);

        await stack.execute(
          new TestCommand('edit B in context1', 'modelB'),
          context1
        );
        dirtyModels = stack.getDirtyModelIds(context1);
        expect(dirtyModels).to.contain('modelA').and.to.contain('modelB');
      });

      it('execute a compound makes all dirty', async () => {
        await stack.execute(
          normalAppend(
            new TestCommand('edit A', 'modelA'),
            new TestCommand('edit B', 'modelB')
          ),
          context1
        );
        const dirtyModels = stack.getDirtyModelIds(context1);
        expect(dirtyModels).to.be.eql(['modelA', 'modelB']);
      });

      it('mark saved', async () => {
        await stack.execute(new TestCommand('edit A', 'modelA'), context1);
        await stack.execute(new TestCommand('edit B', 'modelB'), context2);
        stack.markSaved(context1);
        expect(stack.isDirty(context1)).to.be.false;
        let dirtyModels = stack.getDirtyModelIds(context1);
        expect(dirtyModels).to.be.eql([]);
        expect(stack.isDirty(context2)).to.be.true;
        dirtyModels = stack.getDirtyModelIds(context2);
        expect(dirtyModels).to.be.eql(['modelB']); // This wasn't saved
        stack.markSaved(context2);
        expect(stack.isDirty(context2)).to.be.false;
        dirtyModels = stack.getDirtyModelIds(context2);
        expect(dirtyModels).to.be.eql([]);

        await stack.execute(
          new TestCommand('edit B in context1', 'modelB'),
          context1
        );
        dirtyModels = stack.getDirtyModelIds(context1);
        expect(dirtyModels).to.be.eql(['modelB']);
      });

      it('undo and redo after save', async () => {
        await stack.execute(new TestCommand('edit A', 'modelA'), context1);
        stack.markSaved(context1);
        await stack.undo(context1);
        expect(stack.isDirty(context1)).to.be.true;
        let dirtyModels = stack.getDirtyModelIds(context1);
        expect(dirtyModels).to.be.eql(['modelA']);
        await stack.redo(context1);
        expect(stack.isDirty(context1)).to.be.false;
        dirtyModels = stack.getDirtyModelIds(context1);
        expect(dirtyModels).to.be.eql([]);
      });

      it('redo and undo after save', async () => {
        await stack.execute(new TestCommand('edit A', 'modelA'), context1);
        await stack.undo(context1);
        stack.markSaved(context1);

        await stack.redo(context1);
        expect(stack.isDirty(context1)).to.be.true;
        let dirtyModels = stack.getDirtyModelIds(context1);
        expect(dirtyModels).to.be.eql(['modelA']);
        await stack.undo(context1);
        expect(stack.isDirty(context1)).to.be.false;
        dirtyModels = stack.getDirtyModelIds(context1);
        expect(dirtyModels).to.be.eql([]);
      });

      it('flush and then save', async () => {
        await stack.execute(new TestCommand('edit A', 'modelA'), context1);
        stack.flush(context1);
        expect(stack.isDirty(context1)).to.be.true;
        let dirtyModels = stack.getDirtyModelIds(context1);
        expect(dirtyModels).to.be.eql(['modelA']);
        stack.markSaved(context1);
        expect(stack.isDirty(context1)).to.be.false;
        dirtyModels = stack.getDirtyModelIds(context1);
        expect(dirtyModels).to.be.eql([]);
      });

      it('save and then flush', async () => {
        await stack.execute(new TestCommand('edit A', 'modelA'), context1);
        stack.markSaved(context1);
        expect(stack.isDirty(context1)).to.be.false;
        let dirtyModels = stack.getDirtyModelIds(context1);
        expect(dirtyModels).to.be.eql([]);
        stack.flush(context1);
        expect(stack.isDirty(context1)).to.be.false;
        dirtyModels = stack.getDirtyModelIds(context1);
        expect(dirtyModels).to.be.eql([]);
      });

      it('flush and then modify another model', async () => {
        await stack.execute(new TestCommand('edit A', 'modelA'), context1);
        stack.flush(context1);
        await stack.execute(new TestCommand('edit B', 'modelB'), context1);
        let dirtyModels = stack.getDirtyModelIds(context1);
        expect(dirtyModels).to.be.eql(['modelA', 'modelB']);
        stack.markSaved(context1);
        dirtyModels = stack.getDirtyModelIds(context1);
        expect(dirtyModels).to.be.eql([]);
      });

      it('flush multiple times', async () => {
        await stack.execute(new TestCommand('edit A', 'modelA'), context1);
        stack.flush(context1);
        let dirtyModels = stack.getDirtyModelIds(context1);
        expect(dirtyModels).to.be.eql(['modelA']);
        await stack.execute(new TestCommand('edit B', 'modelB'), context1);
        stack.flush(context1);
        dirtyModels = stack.getDirtyModelIds(context1);
        expect(dirtyModels).to.be.eql(['modelA', 'modelB']);
        stack.flush(context1);
        dirtyModels = stack.getDirtyModelIds(context1);
        expect(dirtyModels).to.be.eql(['modelA', 'modelB']);
      });

      it('undo multiple times after save', async () => {
        await stack.execute(new TestCommand('edit A 1', 'modelA'), context1);
        await stack.execute(new TestCommand('edit A 2', 'modelA'), context1);
        await stack.execute(new TestCommand('edit A 3', 'modelA'), context1);
        stack.markSaved(context1);
        await stack.execute(new TestCommand('edit A 1', 'modelA'), context1);

        let dirtyModels = stack.getDirtyModelIds(context1);
        expect(dirtyModels).to.be.eql(['modelA']);

        await stack.undo(context1);
        dirtyModels = stack.getDirtyModelIds(context1);
        expect(dirtyModels).to.be.eql([]);

        await stack.undo(context1);
        dirtyModels = stack.getDirtyModelIds(context1);
        expect(dirtyModels).to.be.eql(['modelA']);

        await stack.undo(context1);
        dirtyModels = stack.getDirtyModelIds(context1);
        expect(dirtyModels).to.be.eql(['modelA']);

        stack.markSaved(context1);
        dirtyModels = stack.getDirtyModelIds(context1);
        expect(dirtyModels).to.be.eql([]);

        await stack.redo(context1);
        await stack.redo(context1);
        dirtyModels = stack.getDirtyModelIds(context1);
        expect(dirtyModels).to.be.eql(['modelA']);
      });

      it('notifications in multiple contexts', async () => {
        const singleContextCallback = sandbox.stub();
        const allContextsCallback = sandbox.stub();
        const singleContextSub = stack.subscribe(context2);
        singleContextSub.onDirtyStateChanged = singleContextCallback;
        const allContextsSub = stack.subscribe();
        allContextsSub.onDirtyStateChanged = allContextsCallback;

        await stack.execute(
          normalAppend(
            new TestCommand('edit A 1', 'modelA'),
            new TestCommand('edit B 1', 'modelB')
          ),
          context1,
          context2
        );

        expect(singleContextCallback).to.have.been.calledOnce;
        expect(singleContextCallback).to.have.been.calledWithMatch(
          context2,
          sinon.match.map.deepEquals(
            new Map([
              ['modelA', true],
              ['modelB', true],
            ])
          )
        );
        expect(allContextsCallback).to.have.been.calledTwice;
        expect(allContextsCallback).to.have.been.calledWithMatch(
          context1,
          sinon.match.map.deepEquals(
            new Map([
              ['modelA', true],
              ['modelB', true],
            ])
          )
        );
        expect(allContextsCallback).to.have.been.calledWithMatch(
          context2,
          sinon.match.map.deepEquals(
            new Map([
              ['modelA', true],
              ['modelB', true],
            ])
          )
        );
        singleContextCallback.resetHistory();
        allContextsCallback.resetHistory();

        await stack.execute(new TestCommand('edit A 2', 'modelA'), context1);
        await stack.execute(new TestCommand('edit B 2', 'modelB'), context2);

        expect(singleContextCallback, 'dirty state should not have changed').not
          .to.have.been.called;
        expect(allContextsCallback, 'dirty state should not have changed').not
          .to.have.been.called;
        singleContextCallback.resetHistory();
        singleContextSub.close();
        allContextsCallback.resetHistory();

        stack.markSaved(context1);
        expect(singleContextCallback, 'subscription not closed').not.to.have
          .been.called;
        expect(allContextsCallback).to.have.been.calledWithMatch(
          context1,
          sinon.match.map.deepEquals(
            new Map([
              ['modelA', false],
              ['modelB', false],
            ])
          )
        );
        stack.markSaved(context2);
        expect(allContextsCallback).to.have.been.calledWithMatch(
          context2,
          sinon.match.map.deepEquals(
            new Map([
              ['modelA', false],
              ['modelB', false],
            ])
          )
        );
        allContextsCallback.resetHistory();

        await stack.undo(context2);
        expect(allContextsCallback).to.have.been.calledWithMatch(
          context2,
          sinon.match.map.deepEquals(new Map([['modelB', true]]))
        );
        await stack.undo(context1);
        expect(allContextsCallback).to.have.been.calledWithMatch(
          context1,
          sinon.match.map.deepEquals(new Map([['modelA', true]]))
        );
        allContextsCallback.resetHistory();

        await stack.redo(context1);
        expect(allContextsCallback).to.have.been.calledWithMatch(
          context1,
          sinon.match.map.deepEquals(new Map([['modelA', false]]))
        );
        await stack.redo(context2);
        expect(allContextsCallback).to.have.been.calledWithMatch(
          context2,
          sinon.match.map.deepEquals(new Map([['modelB', false]]))
        );
        allContextsCallback.resetHistory();

        await stack.execute(new TestCommand('edit A 3', 'modelA'), context1);
        await stack.execute(new TestCommand('edit B 3', 'modelB'), context2);
        expect(allContextsCallback).to.have.been.calledWithMatch(
          context1,
          sinon.match.map.deepEquals(new Map([['modelA', true]]))
        );
        expect(allContextsCallback).to.have.been.calledWithMatch(
          context2,
          sinon.match.map.deepEquals(new Map([['modelB', true]]))
        );
        stack.markSaved(context2);
        expect(allContextsCallback).to.have.been.calledWithMatch(
          context2,
          sinon.match.map.deepEquals(new Map([['modelB', false]]))
        );
        allContextsCallback.resetHistory();

        await stack.undo(context2);
        await stack.undo(context2);
        expect(allContextsCallback).to.have.been.calledOnce;
        expect(allContextsCallback).to.have.been.calledWithMatch(
          context2,
          sinon.match.map.deepEquals(new Map([['modelB', true]]))
        );

        stack.markSaved(context2);
      });

      it('redundant markSaved', async () => {
        await stack.execute(new TestCommand('edit A', 'modelA'), context1);

        const callback = sandbox.stub();
        const sub = stack.subscribe(context1);
        sub.onDirtyStateChanged = callback;

        stack.markSaved(context1);
        expect(callback).to.have.been.calledOnce;
        expect(callback).to.have.been.calledWithMatch(
          context1,
          sinon.match.map.deepEquals(new Map([['modelA', false]]))
        );
        callback.resetHistory();

        stack.markSaved(context1);
        expect(callback).not.to.have.been.called;
      });
    });

    describe('exception handling', () => {
      it('exception in a command does not destabilize the stack', async () => {
        // Execute some operation on A that bombs and on B that doesn't
        const bomb = new TestCommand('Boom!', 'modelA');
        sandbox.stub(bomb, 'execute').throws();
        const edit = new TestCommand('Edit', 'modelB');

        const execA = stack.execute(bomb, context1);
        const execB = stack.execute(edit, context2);
        await expect(execA).to.eventually.be.rejected;
        await expect(execB).to.eventually.be.fulfilled;

        // Double-check
        expect(bomb.wasExecuted).to.be.false;
        expect(edit.wasExecuted).to.be.true;
      });

      it('each caller gets its own appropriate exception', async () => {
        const bombA = new TestCommand('Boom!A', 'modelA');
        sandbox.stub(bombA, 'execute').callsFake(() => {
          throw new Error('A!');
        });
        const bombB = new TestCommand('Boom!B', 'modelB');
        sandbox.stub(bombB, 'execute').callsFake(() => {
          throw new Error('B!');
        });

        const execA = stack.execute(bombA, context1);
        const execB = stack.execute(bombB, context2);
        await expect(execA).to.eventually.be.rejectedWith('A!');
        await expect(execB).to.eventually.be.rejectedWith('B!');
      });

      it('exceptions in dirty state callback', async () => {
        const consoleError = sandbox.stub(console, 'error');
        const singleContextCallback = sandbox.stub().throws();
        const allContextsCallback = sandbox.stub();
        const singleContextSub = stack.subscribe(context1);
        singleContextSub.onDirtyStateChanged = singleContextCallback;
        const allContextsSub = stack.subscribe();
        allContextsSub.onDirtyStateChanged = allContextsCallback;

        await stack.execute(new TestCommand('edit A', 'modelA'), context1);

        expect(consoleError).to.have.been.calledWith(
          'Uncaught exception in CoreCommandStack call-back.'
        );
        expect(allContextsCallback).to.have.been.called;
      });
    });
  });

  describe('Follow-up Command Hook', () => {
    let commitStub: sinon.SinonStub;
    let followUpStub: sinon.SinonStub;
    let followUpCommand: TestCommand;

    beforeEach(() => {
      commitStub = sandbox.stub(workingCopyManager, 'commit');
      followUpCommand = new TestCommand('/fup');
      followUpStub = sandbox.stub(workingCopyManager, 'createFollowUpCommand');
      stack = new CoreCommandStackImpl(workingCopyManager);
    });

    // Abstract definition of similar scenarios to cover interactions with the command stack
    describe('scenarios', () => {
      const scenarios: [
        string,
        (() => Promise<Map<Command, Operation[]> | undefined>) | undefined,
        () => Promise<Map<Command, Operation[]> | undefined>,
        () => Command[]
      ][] = [
        [
          'execute',
          undefined,
          () => stack.execute(command1, context1),
          () => [command1],
        ],
        [
          'executeAndAppend',
          () => stack.execute(command2, context1),
          () => stack.executeAndAppend(context1, command1),
          () => [command1],
        ],
        [
          'undo',
          () => stack.execute(command1, context1),
          () => stack.undo(context1),
          () => [command1],
        ],
        [
          'redo',
          () =>
            stack.execute(command1, context1).then(() => stack.undo(context1)),
          () => stack.redo(context1),
          () => [command1],
        ],
      ];

      // Template of a test suite to cover interaction scenarios with the command stack
      const testScript = (
        suite: string,
        assertions: (
          title: string,
          result: Map<Command, Operation[]> | undefined,
          commands: Command[]
        ) => MaybePromise<void>
      ) => {
        describe(suite, () => {
          for (const [
            title,
            preparation,
            stackInteraction,
            commands,
          ] of scenarios) {
            it(title, async () => {
              await preparation?.();

              sandbox.resetHistory();
              followUpStub.returns(followUpCommand);

              const result = await stackInteraction();

              await assertions(title, result, commands());
            });
          }
        });
      };

      // Iterate the test scenarios for assertion of the return results
      // from each command stack interaction
      testScript('command-stack results', (title, result, commands) => {
        expect(result, `${title} has no result`).to.exist;
        expect(
          Array.from(result!.keys()),
          `wrong commands in ${title} result`
        ).to.have.members([...commands, followUpCommand]);
        expect(followUpCommand.wasExecuted, 'follow-up command not executed').to
          .be.true;
        expect(
          result!.get(followUpCommand),
          `follow-up not included in ${title} result`
        ).to.be.deep.equal([
          {
            op: 'add',
            path: '/fup',
            value: 'test-value',
          },
        ]);

        const purged = stack.flush(context1);
        expect(
          purged,
          'follow-up was included in editing context'
        ).not.to.include(followUpCommand);
        expect(stack, 'follow-up was recorded in some history').to.be.like({
          _top: undefined,
          _undoEntries: new Map(),
          _redoEntries: new Map(),
        });
      });

      // Iterate the test scenarios for assertion of the notifications
      // emanating from each command stack interaction
      testScript('notifications', (title, _, commands) => {
        expect(commitStub).to.have.been.calledOnce;
        const args = commitStub.args[0][0] as Map<Command, Operation[]>;

        expect(args).to.exist;
        expect(
          Array.from(args.keys()),
          `wrong commands in ${title} notification`
        ).to.have.members([...commands, followUpCommand]);
        expect(
          args.get(followUpCommand),
          `follow-up not included in ${title} notification`
        ).to.be.deep.equal([
          {
            op: 'add',
            path: '/fup',
            value: 'test-value',
          },
        ]);
      });
    });

    describe('edge cases', () => {
      let consoleErrorStub: sinon.SinonStub;

      beforeEach(() => {
        consoleErrorStub = sandbox.stub(console, 'error');
      });

      it('handles follow-up execution not returning results', async () => {
        const noResultsCommand = new TestCommand('/a');
        const executeStub = sandbox.stub(noResultsCommand, 'execute');

        followUpStub.returns(noResultsCommand);

        const result = await stack.execute(command1, context1);

        expect(executeStub).to.have.been.calledOnce;

        expect(result).to.exist;
        expect(result?.get(command1)).to.exist;
        expect(result?.get(noResultsCommand)).not.to.exist;
      });

      it('handles non-executable follow-up command', async () => {
        const nonExecutableCommand = new TestCommand('/a');
        sandbox
          .stub(nonExecutableCommand, 'canExecute')
          .returns(Promise.resolve(false));

        followUpStub.returns(nonExecutableCommand);

        const result = await stack.execute(command1, context1);

        expect(nonExecutableCommand.wasExecuted).to.be.false;

        expect(result).to.exist;
        expect(result?.get(command1)).to.exist;
        expect(result?.get(nonExecutableCommand)).not.to.exist;

        expect(consoleErrorStub).to.have.been.calledWithMatch(
          'Follow-up command is not executable'
        );
      });

      it('unexpected missing working copy', async () => {
        let countdown = 1;
        sandbox.stub(workingCopyManager, 'getWorkingCopy').callsFake(() => {
          if (countdown-- <= 0) {
            return undefined;
          }
          return {};
        });

        await expect(
          stack.execute(new TestCommand('rug pull', 'foo'), context1)
        ).to.eventually.be.rejectedWith('Model foo does not exist');
      });
    });
  });
});

class TestCommand implements SimpleCommand {
  constructor(public readonly label: string, public modelId = 'test-model') {}

  public wasExecuted = false;
  public wasUndone = false;
  public wasRedone = false;

  async canExecute(): Promise<boolean> {
    return !this.wasExecuted && !this.wasUndone && !this.wasRedone;
  }

  async canUndo(): Promise<boolean> {
    return this.wasExecuted || this.wasRedone;
  }

  async canRedo(): Promise<boolean> {
    return this.wasUndone;
  }

  async execute(): Promise<Operation[] | undefined> {
    if (!this.canExecute()) {
      throw new Error('cannot execute');
    }
    this.wasExecuted = true;
    this.wasUndone = false;
    this.wasRedone = false;
    return [{ op: 'add', path: this.label, value: 'test-value' }];
  }

  async undo(): Promise<Operation[] | undefined> {
    if (!this.canUndo()) {
      throw new Error('cannot undo');
    }
    this.wasExecuted = false;
    this.wasUndone = true;
    this.wasRedone = false;
    return [{ op: 'remove', path: this.label }];
  }

  async redo(): Promise<Operation[] | undefined> {
    if (!this.canRedo()) {
      throw new Error('cannot redo');
    }
    this.wasExecuted = false;
    this.wasUndone = false;
    this.wasRedone = true;
    return [{ op: 'add', path: this.label, value: 'test-value' }];
  }
}
