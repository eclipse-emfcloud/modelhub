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
import chaiLike from 'chai-like';
import type { Operation } from 'fast-json-patch';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import type { Command, CompoundCommand, SimpleCommand } from '../command';
import {
  append,
  CompoundCommandImpl,
  groupByModelId,
  isCompoundCommand,
  isSimpleCommandWithResult,
} from '../command';

chai.use(chaiLike);
chai.use(chaiAsPromised);
chai.use(sinonChai);

describe('Command-related functions', () => {
  describe('isCompoundCommand', () => {
    it('detects a CompoundCommand', async () => {
      const compound = new CompoundCommandImpl('test');
      const isCompound = isCompoundCommand(compound);

      expect(isCompound, 'compound command not detected').to.be.true;
    });

    it('detects a simple (non-compound) Command', async () => {
      const leaf = new TestCommand('test');
      const isCompound = isCompoundCommand(leaf);

      expect(isCompound, 'simple command not detected').to.be.false;
    });
  });

  describe('append', () => {
    it('base is already a CompoundCommand', async () => {
      const compound = new CompoundCommandImpl('test');
      const appended = new TestCommand('appended');
      const result = append(compound, appended);

      expect(result, 'compound command not appended').to.be.equal(compound);
      expect(result).to.be.like({ _commands: [appended] });
    });

    it('base is not a CompoundCommand', async () => {
      const base = new TestCommand('test');
      const appended = new TestCommand('appended');
      const result = append(base, appended);

      expect(result, 'commands not compounded').to.be.instanceOf(
        CompoundCommandImpl
      );
      expect(result).to.be.like({ _commands: [base, appended] });
    });

    it('is given nothing to append', async () => {
      const base = new TestCommand('test');
      const result = append(base);

      expect(result, 'command was unnecessarily replaced').to.be.equal(base);
    });
  });

  describe('groupByModelId', () => {
    it('group compound command results by model', async () => {
      const models = new Map<string, object>([
        ['model1', { id: 'model1' }],
        ['model2', { id: 'model2' }],
      ]);
      const command1 = new TestCommand('testProp1', 'model1');
      const command2 = new TestCommand('testProp2', 'model1');
      const command3 = new TestCommand('test', 'model2');
      const compoundModel1 = new CompoundCommandImpl(
        'test',
        command1,
        command2
      );
      const compoundModel2 = new CompoundCommandImpl('test', command3);
      const topCompound = new CompoundCommandImpl(
        'test',
        compoundModel1,
        compoundModel2
      );

      const result = await topCompound.execute(models.get.bind(models));
      expect(result).to.not.be.undefined;
      if (result !== undefined) {
        const groupedResult = groupByModelId(result);
        expect(groupedResult.size).to.equal(2);
      }
    });
  });

  describe('isSimpleCommandWithResult', () => {
    it('is not', () => {
      const command = new TestCommand('test', 'model1');
      const isIt = isSimpleCommandWithResult(command);

      expect(isIt).to.be.false;
    });

    it('is', () => {
      const command = new TestCommand('test', 'model1');
      Object.assign(command, { result: 'ok' });
      const isIt = isSimpleCommandWithResult(command);

      expect(isIt).to.be.true;
    });
  });

  // This test ensures a wider test coverage, by crafting test cases that
  // are not expected to happen in a more realistic scenario
  it('additional corner cases', () => {
    const command1 = new TestCommand('testProp2', 'model1');
    const command2 = new TestCommand('test', 'model2');
    const compound = new CompoundCommandImpl('test', command1, command2);

    const result = new Map<Command, Operation[]>();
    result.set(command1, undefined as unknown as Operation[]);
    result.set(command2, []);
    result.set(compound, []);

    const groupedResult = groupByModelId(result);
    expect(groupedResult.size).to.equal(1);
    expect(groupedResult.get('model1')).to.be.undefined;
    expect(groupedResult.get('model2')).to.be.an('array').that.is.empty;
  });
});

describe('CompoundCommandImpl', () => {
  let getModel: (modelId: string) => object | undefined;
  let commands: Command[];
  let compound: CompoundCommandImpl;

  const forceAppend = (
    compound: CompoundCommandImpl,
    ...commands: Command[]
  ): void => {
    // Cannot append via the API, so shoehorn it
    (compound as unknown as { _commands: Command[] })._commands.push(
      ...commands
    );
  };

  beforeEach(() => {
    getModel = () => ({});
    commands = [new AsyncTestCommand('a'), new AsyncTestCommand('b')];
    compound = new CompoundCommandImpl('test', ...commands);
  });

  it('has a label', () => {
    expect(compound.label, 'wrong label').to.be.eq('test');
  });

  describe('execute', () => {
    let sandbox: sinon.SinonSandbox;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('executes the subcommands', async () => {
      await compound.execute(getModel);

      expect(commands, 'commands not executed').to.be.like([
        { wasExecuted: true },
        { wasExecuted: true },
      ]);
    });

    it('collates the deltas', async () => {
      const delta = await compound.execute(getModel);

      expect(delta, 'no delta returned').to.exist;
      expect(delta?.get(commands[0]), 'wrong result for command a').to.be.like([
        { op: 'add', path: 'a' },
      ]);
      expect(delta?.get(commands[1]), 'wrong result for command b').to.be.like([
        { op: 'add', path: 'b' },
      ]);
    });

    it('rewinds subcommands on failure', async () => {
      const third = new AsyncTestCommand('c');
      commands.push(third);
      compound.append(third);

      third.failOn('execute');

      await expect(compound.execute(getModel)).to.eventually.have.rejected;

      expect(commands, 'commands not rewound').to.be.like([
        { wasUndone: true, failed: false },
        { wasUndone: true, failed: false },
        { wasExecuted: false, failed: true },
      ]);
    });

    it('best-effort rewinds in case of rewind failure', async () => {
      const third = new AsyncTestCommand('c');
      commands.push(third);
      compound.append(third);

      third.failOn('execute');
      (commands[1] as AsyncTestCommand).failOn('undo');

      const consoleError = sandbox.stub(console, 'error');
      await expect(compound.execute(getModel)).to.eventually.have.rejected;

      expect(consoleError).to.have.been.calledWithMatch(
        'Error in recovery of failed execute.'
      );
      expect(commands, 'commands not rewound').to.be.like([
        { wasUndone: true, failed: false },
        { wasUndone: false, failed: true },
        { wasExecuted: false, failed: true },
      ]);
    });

    describe('asserts the preconditions', () => {
      it('is non-executable by itself', async () => {
        // Make it non-executable
        await compound.execute(getModel);

        await expect(
          compound.execute(getModel),
          'compound should not have executed'
        ).to.eventually.be.rejected;
      });

      it('is non-executable by a nested command', async () => {
        // Make it non-executable
        await commands[1].execute(getModel);

        await expect(
          compound.execute(getModel),
          'compound should not have executed'
        ).to.eventually.be.rejected;
      });
    });
  });

  describe('undo', () => {
    beforeEach(() => {
      return compound.execute(getModel);
    });

    it('undoes the subcommands', async () => {
      await compound.undo(getModel);

      expect(commands, 'commands not undone').to.be.like([
        { wasUndone: true },
        { wasUndone: true },
      ]);
    });

    it('collates the deltas', async () => {
      const delta = await compound.undo(getModel);

      expect(delta, 'no delta returned').to.exist;
      expect(delta?.get(commands[0]), 'wrong result for command a').to.be.like([
        { op: 'remove', path: 'a' },
      ]);
      expect(delta?.get(commands[1]), 'wrong result for command b').to.be.like([
        { op: 'remove', path: 'b' },
      ]);
    });

    it('rewinds subcommands on failure', async () => {
      const third = new AsyncTestCommand('c');
      await third.execute();

      commands.push(third);
      forceAppend(compound, third);

      (commands[0] as AsyncTestCommand).failOn('undo');

      await expect(compound.undo(getModel)).to.eventually.have.rejected;

      expect(commands, 'commands not rewound').to.be.like([
        { wasUndone: false, failed: true },
        { wasRedone: true, failed: false },
        { wasRedone: true, failed: false },
      ]);
    });

    describe('asserts the preconditions', () => {
      it('is non-undoable by itself', async () => {
        // Make it non-undoable
        await compound.undo(getModel);

        await expect(compound.undo(getModel), 'compound should not have undone')
          .to.eventually.be.rejected;
      });

      it('is non-undoable by a nested command', async () => {
        // Make it non-undoable
        await commands[0].undo(getModel);

        await expect(compound.undo(getModel), 'compound should not have undone')
          .to.eventually.be.rejected;
      });
    });
  });

  describe('redo', () => {
    beforeEach(async () => {
      await compound.execute(getModel);
      await compound.undo(getModel);
    });

    it('redoes the subcommands', async () => {
      await compound.redo(getModel);

      expect(commands, 'commands not redone').to.be.like([
        { wasRedone: true },
        { wasRedone: true },
      ]);
    });

    it('collates the deltas', async () => {
      const delta = await compound.redo(getModel);

      expect(delta, 'no delta returned').to.exist;
      expect(delta?.get(commands[0]), 'wrong result for command a').to.be.like([
        { op: 'add', path: 'a' },
      ]);
      expect(delta?.get(commands[1]), 'wrong result for command b').to.be.like([
        { op: 'add', path: 'b' },
      ]);
    });

    describe('asserts the preconditions', () => {
      it('is non-redoable by itself', async () => {
        // Make it non-redoable
        await compound.redo(getModel);

        await expect(compound.redo(getModel), 'compound should not have redone')
          .to.eventually.be.rejected;
      });

      it('is non-redoable by a nested command', async () => {
        // Make it non-redoable
        await commands[1].redo(getModel);

        await expect(compound.redo(getModel), 'compound should not have redone')
          .to.eventually.be.rejected;
      });
    });
  });

  describe('canExecute', () => {
    it('is true', () => {
      return expect(compound.canExecute(getModel), 'compound not executable').to
        .eventually.be.true;
    });

    it('is false by reason of being an empty compound', () => {
      const empty = new CompoundCommandImpl('empty');
      return expect(empty.canExecute(getModel), 'empty compound is executable')
        .to.eventually.be.false;
    });

    it('is false by reason of itself', async () => {
      await compound.execute(getModel); // Make it non-executable by executing it

      return expect(compound.canExecute(getModel), 'compound is executable').to
        .eventually.be.false;
    });

    describe('asynchronous commands', () => {
      it('is false by reason of a nested command', async () => {
        await commands[1].execute(getModel); // Make one non-executable by executing it

        return expect(compound.canExecute(getModel), 'compound is executable')
          .to.eventually.be.false;
      });
    });

    describe('synchronous commands', () => {
      beforeEach(() => {
        commands = [new TestCommand('a'), new TestCommand('b')];
        compound = new CompoundCommandImpl('test', ...commands);
      });

      it('is false by reason of a nested command', () => {
        commands[1].execute(getModel); // Make one non-executable by executing it

        return expect(compound.canExecute(getModel), 'compound is executable')
          .to.eventually.be.false;
      });
    });
  });

  describe('canUndo', () => {
    beforeEach(() => {
      return compound.execute(getModel);
    });

    it('is true', () => {
      return expect(compound.canUndo(getModel), 'compound not undoable').to
        .eventually.be.true;
    });

    it('is false by reason of itself', async () => {
      // Make it non-undoable by undoing it
      await compound.undo(getModel);

      return expect(compound.canUndo(getModel), 'compound is undoable').to
        .eventually.be.false;
    });

    describe('asynchronous commands', () => {
      it('is false by reason of a nested command', async () => {
        // Make one non-undoable by undoing it
        await commands[0].undo(getModel);

        return expect(compound.canUndo(getModel), 'compound is undoable').to
          .eventually.be.false;
      });
    });

    describe('synchronous commands', () => {
      beforeEach(() => {
        commands = [new TestCommand('a'), new TestCommand('b')];
        compound = new CompoundCommandImpl('test', ...commands);
        return compound.execute(getModel);
      });

      it('is false by reason of a nested command', () => {
        commands[0].undo(getModel); // Make one non-undoable by executing it

        return expect(compound.canUndo(getModel), 'compound is undoable').to
          .eventually.be.false;
      });
    });
  });

  describe('canRedo', () => {
    beforeEach(async () => {
      await compound.execute(getModel);
      await compound.undo(getModel);
    });

    it('is true', () => {
      return expect(compound.canRedo(getModel), 'compound not redoable').to
        .eventually.be.true;
    });

    it('is false by reason of itself', async () => {
      // Make it non-undoable by redoing it
      await compound.redo(getModel);

      return expect(compound.canRedo(getModel), 'compound is redoable').to
        .eventually.be.false;
    });

    describe('asynchronous commands', () => {
      it('is false by reason of a nested command', async () => {
        // Make one non-undoable by redoing it
        await commands[1].redo(getModel);

        return expect(compound.canRedo(getModel), 'compound is redoable').to
          .eventually.be.false;
      });
    });

    describe('synchronous commands', () => {
      beforeEach(async () => {
        commands = [new TestCommand('a'), new TestCommand('b')];
        compound = new CompoundCommandImpl('test', ...commands);
        await compound.execute(getModel);
        await compound.undo(getModel);
      });

      it('is false by reason of a nested command', () => {
        // Make one non-redoable by redoing it
        commands[1].redo(getModel);

        return expect(compound.canRedo(getModel), 'compound is redoable').to
          .eventually.be.false;
      });
    });
  });

  describe('append', () => {
    let newCommand: Command;

    beforeEach(() => {
      newCommand = new AsyncTestCommand('c');
    });

    it('is appendable', () => {
      compound.append(newCommand);

      expect(compound, 'new command not appended').to.be.like({
        _commands: [{ label: 'a' }, { label: 'b' }, { label: 'c' }],
      });
    });

    it('is frozen', async () => {
      await compound.execute(getModel);

      expect(
        () => compound.append(newCommand),
        'should have thrown precondition error'
      ).to.throw();
    });
  });

  describe('getCommands', () => {
    it('returns the commands', () => {
      const list = compound.getCommands();

      expect(list, 'wrong commands returned').to.be.like([
        { label: 'a' },
        { label: 'b' },
      ]);
    });

    it('returns a safe copy', () => {
      const list = compound.getCommands();
      list.splice(0, 1);

      expect(compound, 'command removed from the compound').to.be.like({
        _commands: [{ label: 'a' }, { label: 'b' }],
      });
    });
  });

  describe('nested compounds', () => {
    let nested: Command[];
    let nestedCompound: CompoundCommand;
    let sandbox: sinon.SinonSandbox;

    const obtrudeExecute = (cmd: Command) => {
      const stub = sandbox.stub(cmd, 'execute').callsFake((...args) => {
        stub.wrappedMethod.apply(cmd, args);
        return undefined;
      });
    };

    beforeEach(() => {
      nested = [new AsyncTestCommand('c'), new AsyncTestCommand('d')];
      nestedCompound = new CompoundCommandImpl('nested', ...nested);
      compound.append(nestedCompound);
      sandbox = sinon.createSandbox();
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('collates the nested deltas', async () => {
      const delta = await compound.execute(getModel);

      expect(delta, 'no delta returned').to.exist;
      expect(delta?.size, 'wrong number of deltas returned').to.be.eq(4);
      expect(delta?.get(nested[0])).to.be.like([{ op: 'add', path: 'c' }]);
      expect(delta?.get(nested[1])).to.be.like([{ op: 'add', path: 'd' }]);
      expect(delta?.has(commands[0])).to.be.true;
      expect(delta?.has(commands[1])).to.be.true;
    });

    it('returns partial results', async () => {
      obtrudeExecute(nested[0]);
      commands.forEach((cmd) => sandbox.spy(cmd, 'execute'));

      const delta = await compound.execute(getModel);

      expect(delta, 'a partial delta was not returned').to.exist;
      expect(delta?.get(nested[1])).to.be.like([{ op: 'add', path: 'd' }]);
      expect(Array.from(delta?.keys() ?? [])).to.include.members(commands);

      commands.forEach((cmd) => expect(cmd.execute).to.have.been.called);
    });

    it('returns undefined if no results', async () => {
      nested.forEach(obtrudeExecute);
      commands.forEach(obtrudeExecute);

      const delta = await compound.execute(getModel);

      expect(delta, 'a delta was returned').not.to.exist;

      nested.forEach((cmd) => expect(cmd.execute).to.have.been.called);
      commands.forEach((cmd) => expect(cmd.execute).to.have.been.called);
    });
  });

  describe('iteration', () => {
    it('empty compound', () => {
      const labels = new CompoundCommandImpl('test').map((cmd) => cmd.label);
      expect(labels).to.eql([]);
    });

    it('flat compound', () => {
      const compound = new CompoundCommandImpl(
        'test',
        new TestCommand('a'),
        new TestCommand('b')
      );

      const labels = compound.map((cmd) => cmd.label);
      expect(labels).to.eql(['a', 'b']);
    });

    it('nested compound', () => {
      const compound = new CompoundCommandImpl(
        'test',
        new CompoundCommandImpl(
          'one',
          new TestCommand('a'),
          new TestCommand('b')
        ),
        new TestCommand('c'),
        new CompoundCommandImpl(
          'two',
          new TestCommand('d'),
          new CompoundCommandImpl(
            'three',
            new TestCommand('e'),
            new TestCommand('f')
          ),
          new TestCommand('g')
        )
      );

      const labels = compound.map((cmd) => cmd.label);
      expect(labels).to.eql(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    });
  });

  describe('Compounds of compounds', () => {
    beforeEach(async () => {
      commands = [
        new AsyncTestCommand('a', 'a'),
        new TestCommand('b'),
        new AsyncTestCommand('c', 'c'),
      ];
      compound = new CompoundCommandImpl(
        'outer',
        commands[0],
        new CompoundCommandImpl('inner', ...commands.slice(1))
      );
    });

    it('execute', async () => {
      await compound.execute(getModel);
      expect(commands, 'commands not executed').to.be.like([
        { wasExecuted: true },
        { wasExecuted: true },
        { wasExecuted: true },
      ]);
    });

    it('undo', async () => {
      await compound.execute(getModel);
      await compound.undo(getModel);

      expect(commands, 'commands not undone').to.be.like([
        { wasUndone: true },
        { wasUndone: true },
        { wasUndone: true },
      ]);
    });

    it('redo', async () => {
      await compound.execute(getModel);
      await compound.undo(getModel);
      await compound.redo(getModel);

      expect(commands, 'commands not redone').to.be.like([
        { wasRedone: true },
        { wasRedone: true },
        { wasRedone: true },
      ]);
    });

    it('rewinds subcommands on failure', async () => {
      await compound.execute(getModel);
      const fourth = new AsyncTestCommand('d');
      await fourth.execute();

      commands.push(fourth);
      forceAppend(compound, fourth);

      (commands[0] as AsyncTestCommand).failOn('undo');

      await expect(compound.undo(getModel)).to.eventually.have.rejected;

      expect(commands, 'commands not rewound').to.be.like([
        { wasUndone: false, failed: true },
        { wasRedone: true },
        { wasRedone: true },
        { wasRedone: true },
      ]);
    });

    it('model AWOL on execute', async () => {
      let countdown = 2;
      getModel = (modelId: string) => {
        if (modelId === 'c' && countdown-- <= 0) {
          return undefined;
        }
        return {};
      };
      await expect(compound.execute(getModel)).to.eventually.have.rejectedWith(
        'No model on which to execute'
      );
    });

    it('model AWOL on rewind', async () => {
      const bomb = new AsyncTestCommand('Boom!');
      bomb.failOn('execute');
      commands.push(bomb);
      forceAppend(compound, bomb);

      let countdown = 2;
      getModel = (modelId: string) => {
        if (modelId === 'a' && countdown-- <= 0) {
          return undefined;
        }
        return {};
      };

      // The exception from rewind isn't actually surfaced
      await expect(compound.execute(getModel)).to.eventually.have.rejected;
      expect(commands[1]).to.be.like({ wasUndone: true });
      expect(commands[0]).to.be.like({ wasUndone: false });
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

  execute(): Operation[] | undefined {
    if (!this.canExecute()) {
      throw new Error('cannot execute');
    }
    this.wasExecuted = true;
    this.wasUndone = false;
    this.wasRedone = false;
    return [{ op: 'add', path: this.label, value: 'test-value' }];
  }

  undo(): Operation[] | undefined {
    if (!this.canUndo()) {
      throw new Error('cannot undo');
    }
    this.wasExecuted = false;
    this.wasUndone = true;
    this.wasRedone = false;
    return [{ op: 'remove', path: this.label }];
  }

  redo(): Operation[] | undefined {
    if (!this.canRedo()) {
      throw new Error('cannot redo');
    }
    this.wasExecuted = false;
    this.wasUndone = false;
    this.wasRedone = true;
    return [{ op: 'add', path: this.label, value: 'test-value' }];
  }
}

class AsyncTestCommand implements SimpleCommand {
  constructor(public readonly label: string, public readonly modelId = '') {}

  public wasExecuted = false;
  public wasUndone = false;
  public wasRedone = false;

  private failOnOp?: keyof SimpleCommand;
  public failed = false;

  failOn(op: keyof SimpleCommand): void {
    this.failOnOp = op;
  }

  async canExecute(): Promise<boolean> {
    this.maybeFailOn('canExecute');
    return !this.wasExecuted && !this.wasUndone && !this.wasRedone;
  }

  async canUndo(): Promise<boolean> {
    this.maybeFailOn('canUndo');
    return this.wasExecuted || this.wasRedone;
  }

  async canRedo(): Promise<boolean> {
    this.maybeFailOn('canRedo');
    return this.wasUndone;
  }

  async execute(): Promise<Operation[] | undefined> {
    if (!this.canExecute()) {
      throw new Error('cannot execute');
    }
    this.maybeFailOn('execute');

    this.wasExecuted = true;
    this.wasUndone = false;
    this.wasRedone = false;

    return [{ op: 'add', path: this.label, value: 'test-value' }];
  }

  async undo(): Promise<Operation[] | undefined> {
    if (!this.canUndo()) {
      throw new Error('cannot undo');
    }
    this.maybeFailOn('undo');

    this.wasExecuted = false;
    this.wasUndone = true;
    this.wasRedone = false;

    return [{ op: 'remove', path: this.label }];
  }

  async redo(): Promise<Operation[] | undefined> {
    if (!this.canRedo()) {
      throw new Error('cannot redo');
    }
    this.maybeFailOn('redo');

    this.wasExecuted = false;
    this.wasUndone = false;
    this.wasRedone = true;

    return [{ op: 'add', path: this.label, value: 'test-value' }];
  }

  private maybeFailOn(op: keyof SimpleCommand): void {
    if (this.failOnOp === op) {
      this.failed = true;
      this.failOnOp = undefined;
      throw new Error(`Failed on ${op} as directed.`);
    }
  }
}
