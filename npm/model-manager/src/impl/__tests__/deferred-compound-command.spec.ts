// *****************************************************************************
// Copyright (C) 2024 STMicroelectronics.
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
import { Command, CompoundCommand, SimpleCommand } from '../../core/command';
import {
  createDeferredCompoundCommand,
  createStrictDeferredCompoundCommand,
} from '../../core/deferred-compound-command';
import { DeferredCompoundCommand } from '../deferred-compound-command-impl';
import {
  AppendableCompoundCommand,
  getModelIds,
} from '../core-command-stack-impl';
import type { Operation } from 'fast-json-patch';
import chaiLike from 'chai-like';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';

chai.use(chaiLike);
chai.use(chaiAsPromised);
chai.use(sinonChai);

describe('optimistic DeferredCompoundCommand', () => {
  let sandbox: sinon.SinonSandbox;

  let getModel: (modelId: string) => object | undefined;
  let commands: Command[];
  let compound: CompoundCommand;

  const provideCommands = () => commands;
  const provideCommandsAsync = async () => commands;
  const provideAsyncCommands = function* () {
    for (const cmd of commands) {
      const next = (async () => cmd)();
      yield next;
    }
  };
  const provideAsyncCommandsAsync = async function () {
    const result = [];
    for (const cmd of provideAsyncCommands()) {
      result.push(cmd);
    }
    return result;
  };

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    getModel = () => ({});
    commands = [new AsyncTestCommand('a'), new AsyncTestCommand('b')];
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('no commands, yet', () => {
    compound = createDeferredCompoundCommand(
      'sync-sync',
      ['the-model'],
      provideCommands
    );
    expect(compound.getCommands()).to.be.an.empty('array');
  });

  describe('execute', () => {
    it('sync provider, sync commands', async () => {
      const provider = sandbox.spy(provideCommands);

      compound = createDeferredCompoundCommand(
        'sync-sync',
        ['the-model'],
        provider
      );

      await compound.execute(getModel);

      expect(commands, 'commands not executed').to.be.like([
        { wasExecuted: true },
        { wasExecuted: true },
      ]);

      expect(provider).to.have.been.calledWithExactly(getModel);
    });

    it('async provider, sync commands', async () => {
      compound = createDeferredCompoundCommand(
        'async-sync',
        ['the-model'],
        provideCommandsAsync
      );

      await compound.execute(getModel);

      expect(commands, 'commands not executed').to.be.like([
        { wasExecuted: true },
        { wasExecuted: true },
      ]);
    });

    it('sync provider, async commands', async () => {
      compound = createDeferredCompoundCommand(
        'sync-async',
        ['the-model'],
        provideAsyncCommands
      );

      await compound.execute(getModel);

      expect(commands, 'commands not executed').to.be.like([
        { wasExecuted: true },
        { wasExecuted: true },
      ]);
    });

    it('async provider, async commands', async () => {
      compound = createDeferredCompoundCommand(
        'async-async',
        ['the-model'],
        provideAsyncCommandsAsync
      );

      await compound.execute(getModel);

      expect(commands, 'commands not executed').to.be.like([
        { wasExecuted: true },
        { wasExecuted: true },
      ]);
    });
  });

  describe('canExecute', () => {
    beforeEach(() => {
      compound = createDeferredCompoundCommand(
        'sync-sync',
        ['the-model'],
        provideCommands
      );
    });

    it('is true', () => {
      return expect(compound.canExecute(getModel), 'compound not executable').to
        .eventually.be.true;
    });

    it('is false by reason of itself', async () => {
      await compound.execute(getModel); // Make it non-executable by executing it

      return expect(compound.canExecute(getModel), 'compound is executable').to
        .eventually.be.false;
    });

    it('uses supplied predicate', async () => {
      const predicate = sandbox.stub().returns(false);
      compound = createDeferredCompoundCommand(
        'sync-sync',
        ['the-model'],
        provideCommands,
        predicate
      );

      await expect(compound.canExecute(getModel), 'compound is executable').to
        .eventually.be.false;

      expect(predicate).to.have.been.calledWithExactly(getModel);
    });
  });

  describe('canUndo', () => {
    describe('with commands that can undo', () => {
      beforeEach(async () => {
        compound = createDeferredCompoundCommand(
          'sync-sync',
          ['the-model'],
          provideCommands
        );
        await compound.execute(getModel);
      });

      it('is true', () => {
        return expect(compound.canUndo(getModel), 'compound not undoable').to
          .eventually.be.true;
      });

      it('is false by reason of itself', async () => {
        await compound.undo(getModel); // Make it non-undoable by undoing it

        return expect(compound.canUndo(getModel), 'compound is executable').to
          .eventually.be.false;
      });
    });

    describe('without constituent commands', () => {
      beforeEach(async () => {
        sandbox = sinon.createSandbox();

        compound = createDeferredCompoundCommand(
          'sync-sync',
          ['the-model'],
          () => []
        );
        await compound.execute(getModel);
      });

      afterEach(() => {
        sandbox.restore();
      });

      it('is true', async () => {
        const spyConsoleDebug = sandbox.spy(console, 'debug');
        const undoResult = await compound.canUndo(getModel);
        expect(undoResult, 'compound not undoable').to.be.true;
        expect(
          spyConsoleDebug,
          'no debug log for no command'
        ).to.have.been.calledWithMatch(
          'model-manager/command:',
          `No constituent command for ${compound.label}.`
        );
      });

      it('is false by reason of itself', async () => {
        await compound.undo(getModel); // Make it non-undoable by undoing it

        expect(compound.canUndo(getModel), 'compound is undoable').to.eventually
          .be.false;
      });
    });
  });

  describe('canRedo', () => {
    describe('with commands that can redo', () => {
      beforeEach(() => {
        compound = createDeferredCompoundCommand(
          'sync-sync',
          ['the-model'],
          provideCommands
        );
      });

      it('is false (not executed yet)', () => {
        return expect(compound.canRedo(getModel), 'compound redoable').to
          .eventually.be.false;
      });

      it('is false (executed but not undone)', async () => {
        await compound.execute(getModel); // Make it undoable by executing it

        return expect(compound.canRedo(getModel), 'compound redoable').to
          .eventually.be.false;
      });

      it('is true (executed and undone)', async () => {
        await compound.execute(getModel); // Make it undoable by executing it
        await compound.undo(getModel); // Make it redoable

        return expect(compound.canRedo(getModel), 'compound is not redoable').to
          .eventually.be.true;
      });
    });

    describe('without constituent commands', () => {
      beforeEach(async () => {
        sandbox = sinon.createSandbox();

        compound = createDeferredCompoundCommand(
          'sync-sync',
          ['the-model'],
          () => []
        );
      });

      afterEach(() => {
        sandbox.restore();
      });

      it('is false (not executed yet)', async () => {
        expect(compound.canRedo(getModel), 'compound redoable').to.eventually.be
          .false;
      });

      it('is false (executed but not undone)', async () => {
        await compound.execute(getModel); // Make it undoable by executing it

        return expect(compound.canRedo(getModel), 'compound redoable').to
          .eventually.be.false;
      });

      it('is true (executed and undone)', async () => {
        await compound.execute(getModel); // Make it undoable by executing it
        await compound.undo(getModel); // Make it non-undoable by undoing it

        const spyConsoleDebug = sandbox.spy(console, 'debug');
        const canRedoResult = await compound.canRedo(getModel);
        expect(canRedoResult, 'compound not redoable').to.be.true;
        expect(
          spyConsoleDebug,
          'no debug log for no command'
        ).to.have.been.calledWithMatch(
          'model-manager/command:',
          `No constituent command for ${compound.label}.`
        );
      });
    });
  });

  describe('model scope', () => {
    beforeEach(() => {
      compound = createDeferredCompoundCommand(
        'sync-sync',
        ['the-model'],
        provideCommands
      );
    });

    it('reports planned scope', () => {
      expect(getModelIds(compound)).to.be.deep.equal(['the-model']);
    });

    it('includes statically added commands', () => {
      compound.append(new TestCommand('static', 'other-model'));

      expect(getModelIds(compound)).to.be.deep.equal([
        'the-model',
        'other-model',
      ]);
    });

    it('warns on scope expansion', async () => {
      const console_warn = sandbox.stub(console, 'warn');
      sandbox.replace(commands[1] as SimpleCommand, 'modelId', 'other-model');

      expect(getModelIds(compound)).to.be.deep.equal(['the-model']);

      await compound.execute(getModel);

      expect(console_warn).to.have.been.calledWithMatch(
        'model-manager/deferred-compound-command-impl:',
        /.*expands the model scope.*/
      );
    });

    it('is frozen after execution', async () => {
      await compound.execute(getModel);

      expect(() =>
        compound.append(new TestCommand('static', 'other-model'))
      ).to.throw('Cannot append to executed compound');
    });
  });

  describe('corner cases', () => {
    it('validation rejects provided commands', async () => {
      compound = new (class extends DeferredCompoundCommand {
        protected validate(
          command: Command<string>
        ): Command<string> | undefined {
          if (command.label === 'b') {
            return undefined;
          }
          return super.validate(command);
        }
      })('sync-sync', ['the-model'], provideCommands);

      await compound.execute(getModel);

      expect(commands, 'rejected commands was executed').to.be.like([
        { wasExecuted: true },
        { wasExecuted: false },
      ]);

      const children = compound.getCommands();
      expect(children.length).to.be.equal(1);
      expect(children[0]).to.be.equal(commands[0]);
    });
  });

  describe('get model Ids with deferred command', () => {
    it('should return an array with the compound command model ids with deferred command', () => {
      const provider = sandbox.spy(provideCommands);

      const deferredCommand = createDeferredCompoundCommand(
        'random-deferred-command',
        ['test-model-id-4', 'test-model-id-5'],
        provider
      );
      commands = [
        new AsyncTestCommand('a', 'test-model'),
        new AsyncTestCommand('b', 'test-model'),
      ];
      compound = new AppendableCompoundCommand('test', ...commands);
      compound.append(deferredCommand);
      expect(getModelIds(compound)).to.be.eql([
        'test-model',
        'test-model-id-4',
        'test-model-id-5',
      ]);
    });
  });
});

describe('strict DeferredCompoundCommand', () => {
  let sandbox: sinon.SinonSandbox;

  let getModel: (modelId: string) => object | undefined;
  let commands: Command[];
  let compound: CompoundCommand;

  const provideCommands = () => commands;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    getModel = () => ({});
    commands = [new AsyncTestCommand('a'), new AsyncTestCommand('b')];
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('no commands, yet', () => {
    compound = createStrictDeferredCompoundCommand(
      'sync-sync',
      ['the-model'],
      provideCommands
    );
    expect(compound.getCommands()).to.be.an.empty('array');
  });

  it('execute', async () => {
    compound = createStrictDeferredCompoundCommand(
      'sync-sync',
      ['the-model'],
      provideCommands
    );

    await compound.execute(getModel);

    expect(commands, 'commands not executed').to.be.like([
      { wasExecuted: true },
      { wasExecuted: true },
    ]);
  });

  describe('canExecute', () => {
    beforeEach(() => {
      compound = createStrictDeferredCompoundCommand(
        'sync-sync',
        ['the-model'],
        provideCommands
      );
    });

    it('is true', () => {
      return expect(compound.canExecute(getModel), 'compound not executable').to
        .eventually.be.true;
    });

    it('is false by reason of itself', async () => {
      await compound.execute(getModel); // Make it non-executable by executing it

      return expect(compound.canExecute(getModel), 'compound is executable').to
        .eventually.be.false;
    });

    it('is false by reason of some provided command', async () => {
      await commands[1].execute(getModel); // Make one non-executable by executing it

      return expect(compound.canExecute(getModel), 'compound is executable').to
        .eventually.be.false;
    });

    it('executable if no commands provided', async () => {
      const spyConsoleDebug = sandbox.spy(console, 'debug');
      compound = createStrictDeferredCompoundCommand(
        'sync-sync',
        ['the-model'],
        () => []
      );

      const result = await compound.canExecute(getModel);
      expect(result, 'compound is not executable').to.be.true;
      expect(spyConsoleDebug).to.have.been.calledWithMatch(
        'model-manager/command:',
        `No constituent command for ${compound.label}.`
      );
    });
  });

  it('prepares only once', async () => {
    const provider = sandbox.spy(provideCommands);
    compound = createStrictDeferredCompoundCommand(
      'sync-sync',
      ['the-model'],
      provider
    );

    await compound.canExecute(getModel);

    expect(provider).to.have.been.calledOnce;

    await compound.execute(getModel);

    expect(provider).to.have.been.calledOnce;
  });
});

//
// Test fixtures
//

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
    if (!this.canExecute()) throw new Error('cannot execute');
    this.wasExecuted = true;
    this.wasUndone = false;
    this.wasRedone = false;
    return [{ op: 'add', path: this.label, value: 'test-value' }];
  }

  undo(): Operation[] | undefined {
    if (!this.canUndo()) throw new Error('cannot undo');
    this.wasExecuted = false;
    this.wasUndone = true;
    this.wasRedone = false;
    return [{ op: 'remove', path: this.label }];
  }

  redo(): Operation[] | undefined {
    if (!this.canRedo()) throw new Error('cannot redo');
    this.wasExecuted = false;
    this.wasUndone = false;
    this.wasRedone = true;
    return [{ op: 'add', path: this.label, value: 'test-value' }];
  }
}

class AsyncTestCommand implements SimpleCommand {
  constructor(
    public readonly label: string,
    public readonly modelId = 'the-model'
  ) {}

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
    if (!this.canExecute()) throw new Error('cannot execute');
    this.maybeFailOn('execute');

    this.wasExecuted = true;
    this.wasUndone = false;
    this.wasRedone = false;

    return [{ op: 'add', path: this.label, value: 'test-value' }];
  }

  async undo(): Promise<Operation[] | undefined> {
    if (!this.canUndo()) throw new Error('cannot undo');
    this.maybeFailOn('undo');

    this.wasExecuted = false;
    this.wasUndone = true;
    this.wasRedone = false;

    return [{ op: 'remove', path: this.label }];
  }

  async redo(): Promise<Operation[] | undefined> {
    if (!this.canRedo()) throw new Error('cannot redo');
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
