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
import { randomInt } from 'crypto';
import type { Operation } from 'fast-json-patch';
import Sinon, { createSandbox, SinonSandbox } from 'sinon';
import type { Command, CoreCommandStack, EditingContext } from '../../core';
import { PatchCommand } from '../../patch';
import { CommandStack, CommandStackImpl } from '../command-stack';

chai.use(chaiLike);

const command: Command = { label: 'do it' } as Command;

const fakeDelta = (): Promise<Map<Command, Operation[]>> =>
  Promise.resolve(
    new Map([[command, [{ op: 'add', path: '/root/a', value: 'test-value' }]]])
  );
const fakeCommandStack = (sandbox: SinonSandbox): CoreCommandStack => {
  const result = <CoreCommandStack>{};
  result.execute = sandbox.fake.returns(fakeDelta());
  result.executeAndAppend = sandbox.fake.returns(fakeDelta());
  result.undo = sandbox.fake.returns(fakeDelta());
  result.redo = sandbox.fake.returns(fakeDelta());
  result.flush = sandbox.fake.returns([command]);
  result.canExecute = sandbox.fake.returns(Promise.resolve(true));
  result.canRedo = sandbox.fake.returns(Promise.resolve(true));
  result.canUndo = sandbox.fake.returns(Promise.resolve(true));
  result.getUndoCommand = sandbox.fake.returns(command);
  result.getRedoCommand = sandbox.fake.returns(command);
  result.markSaved = sandbox.fake();
  result.getDirtyModelIds = sandbox.fake.returns(['dirty']);
  result.isDirty = sandbox.fake.returns(true);
  result.subscribe = sandbox.fake.returns({
    close: sandbox.fake(),
  });
  return result;
};

/** Cast an object's method as a verifiable Sinon spy. */
const verify = <R>(
  func: (...args: unknown[]) => R
): Sinon.SinonSpy<unknown[], R> => func as Sinon.SinonSpy<unknown[], R>;

describe('CommandStackImpl', () => {
  let sandbox: SinonSandbox;
  let core: CoreCommandStack;
  let stack: CommandStack;
  let id: string;
  let editingContext: EditingContext;

  beforeEach(() => {
    sandbox = createSandbox();
    core = fakeCommandStack(sandbox);
    id = 'stack.' + randomInt(1024 * 1024).toString(16);
    editingContext = id;
    stack = new CommandStackImpl(core, { id });
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('execute()', async () => {
    const result = await stack.execute(command);

    expect(
      verify(core.execute).calledWithExactly(command, editingContext),
      'not delegated for its editing context'
    ).to.be.true;
    expect(result, 'wrong return result').is.equal(
      await verify(core.execute).lastCall.returnValue
    );
  });

  it('executeAndAppend()', async () => {
    const result = await stack.executeAndAppend(command);

    expect(
      verify(core.executeAndAppend).calledWithExactly(editingContext, command),
      'not delegated for its editing context'
    ).to.be.true;
    expect(result, 'wrong return result').is.equal(
      await verify(core.executeAndAppend).lastCall.returnValue
    );
  });

  it('canExecute()', async () => {
    const result = await stack.canExecute(command);

    expect(
      verify(core.canExecute).calledWith(command, editingContext),
      'not delegated for its editing context'
    ).to.be.true;
    expect(result, 'wrong return result').is.equal(
      await verify(core.canExecute).lastCall.returnValue
    );
  });

  it('canUndo()', async () => {
    const result = await stack.canUndo();

    expect(
      verify(core.canUndo).calledWith(editingContext),
      'not delegated for its editing context'
    ).to.be.true;
    expect(result, 'wrong return result').is.equal(
      await verify(core.canUndo).lastCall.returnValue
    );
  });

  it('canRedo()', async () => {
    const result = await stack.canRedo();

    expect(
      verify(core.canRedo).calledWith(editingContext),
      'not delegated for its editing context'
    ).to.be.true;
    expect(result, 'wrong return result').is.equal(
      await verify(core.canRedo).lastCall.returnValue
    );
  });

  it('getUndoCommand()', () => {
    const result = stack.getUndoCommand();

    expect(
      verify(core.getUndoCommand).calledWith(editingContext),
      'not delegated for its editing context'
    ).to.be.true;
    expect(result, 'wrong return result').is.equal(
      verify(core.getUndoCommand).lastCall.returnValue
    );
  });

  it('getRedoCommand()', () => {
    const result = stack.getRedoCommand();

    expect(
      verify(core.getRedoCommand).calledWith(editingContext),
      'not delegated for its editing context'
    ).to.be.true;
    expect(result, 'wrong return result').is.equal(
      verify(core.getRedoCommand).lastCall.returnValue
    );
  });

  it('undo()', async () => {
    const result = await stack.undo();

    expect(
      verify(core.undo).calledWith(editingContext),
      'not delegated for its editing context'
    ).to.be.true;
    expect(result, 'wrong return result').is.equal(
      await verify(core.undo).lastCall.returnValue
    );
  });

  it('redo()', async () => {
    const result = await stack.redo();

    expect(
      verify(core.redo).calledWith(editingContext),
      'not delegated for its editing context'
    ).to.be.true;
    expect(result, 'wrong return result').is.equal(
      await verify(core.redo).lastCall.returnValue
    );
  });

  it('flush()', () => {
    const result = stack.flush();

    expect(
      verify(core.flush).calledWith(editingContext),
      'not delegated for its editing context'
    ).to.be.true;
    expect(result, 'wrong return result').is.equal(
      verify(core.flush).lastCall.returnValue
    );
  });

  it('markSaved()', () => {
    stack.markSaved();

    expect(verify(core.markSaved).calledWith(editingContext));
  });

  it('getDirtyModels()', () => {
    const result = stack.getDirtyModelIds();

    expect(verify(core.getDirtyModelIds).calledWith(editingContext));
    expect(result, 'wrong return result').is.equal(
      verify(core.getDirtyModelIds).lastCall.returnValue
    );
  });

  it('isDirty()', () => {
    const result = stack.isDirty();

    expect(verify(core.getDirtyModelIds).calledWith(editingContext));
    expect(result, 'wrong return result').is.equal(
      verify(core.isDirty).lastCall.returnValue
    );
  });

  it('subscribe()', () => {
    const result = stack.subscribe();

    expect(verify(core.subscribe)).calledWith(editingContext);

    const coreSub = verify(core.subscribe).lastCall.returnValue;

    expect(
      coreSub,
      'core subscription has no changed call-back'
    ).to.haveOwnProperty('onContextChanged');
    expect(
      coreSub,
      'core subscription has no dirty call-back'
    ).to.haveOwnProperty('onDirtyStateChanged');

    const onCommandStackChanged = sandbox.stub();
    const onDirtyStateChanged = sandbox.stub();

    const command = new PatchCommand('label', 'model', []);
    const dirtyStateChanges = new Map();
    // The subscription doesn't break when its callbacks aren't set
    coreSub.onContextChanged?.('', 'undone', command);
    coreSub.onDirtyStateChanged?.('', dirtyStateChanges);

    result.onCommandStackChanged = onCommandStackChanged;
    result.onDirtyStateChanged = onDirtyStateChanged;
    coreSub.onContextChanged?.('', 'undone', command);
    expect(onCommandStackChanged).to.have.been.calledWithExactly(
      'undone',
      command
    );
    coreSub.onDirtyStateChanged?.('', dirtyStateChanges);
    expect(onDirtyStateChanged).to.have.been.calledWithExactly(
      dirtyStateChanges
    );

    result.close();
    expect(verify(coreSub.close)).to.have.been.called;
  });

  it('getCoreCommandStack()', () => {
    const underlying = stack.getCoreCommandStack();
    expect(underlying, 'wrong core stack').to.be.equal(core);
  });

  describe('options', () => {
    it('default options', async () => {
      stack = new CommandStackImpl(core, { id });
      await stack.execute(command);
      expect(verify(core.flush)).not.to.have.been.called;
    });

    it('keepHistory option false', async () => {
      stack = new CommandStackImpl(core, { id, keepHistory: false });
      await stack.execute(command);
      expect(verify(core.flush)).to.have.been.called;
    });
  });
});
