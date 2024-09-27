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
import { applyPatch, compare, Operation } from 'fast-json-patch';
import { cloneDeep } from 'lodash';
import { CoreModelManagerImpl } from '..';
import {
  append,
  CoreCommandStack,
  CoreModelManager,
  SimpleCommand,
} from '../../core';

chai.use(chaiAsPromised);

const _modelA = {
  aString: 'A string',
  aNumber: 42,
  details: [{ stringDetail: 'detail', numericDetail: 7 }],
};

const MODELA_ID = 'test:modelA';

describe('Concurrent model modifications', () => {
  const getModelA = () => {
    const modelA = manager.getModel(MODELA_ID);
    expect(modelA).to.exist;
    return modelA as typeof _modelA;
  };

  let manager: CoreModelManager<string>;
  let stack: CoreCommandStack;

  beforeEach(() => {
    manager = new CoreModelManagerImpl();
    stack = manager.getCommandStack();

    manager.setModel(MODELA_ID, cloneDeep(_modelA));
  });

  it('sequential command execution', async () => {
    await stack.execute(
      new NumberCommand(MODELA_ID, (aNumber) => aNumber + 2),
      MODELA_ID
    );
    await stack.execute(
      new NumberCommand(MODELA_ID, (aNumber) => aNumber / 11),
      MODELA_ID
    );

    expect(getModelA().aNumber).to.be.equal(4);
  });

  it('concurrent command execution', async () => {
    const first = stack.execute(
      new NumberCommand(MODELA_ID, (aNumber) => aNumber + 2),
      MODELA_ID
    );
    const second = stack.execute(
      new NumberCommand(MODELA_ID, (aNumber) => aNumber / 11),
      MODELA_ID
    );

    await expect(first).to.eventually.be.fulfilled;
    await expect(second).to.eventually.be.fulfilled;

    expect(getModelA().aNumber).to.be.equal(4);
  });

  it('permits no dirty reads', async () => {
    const first = new NumberCommand(MODELA_ID, (aNumber) => aNumber + 2);
    const second = new NumberCommand(MODELA_ID, (aNumber) => aNumber / 11);

    const composite = append(first, second);
    const execution = stack.execute(composite, MODELA_ID);
    const attemptedDirtyRead = first.executed.then(() => getModelA().aNumber);

    await expect(attemptedDirtyRead).to.eventually.be.equal(42);
    await expect(execution).to.eventually.be.fulfilled;
    expect(getModelA().aNumber).to.be.equal(4);
  });

  it('copies models on write', async () => {
    const initialModelA = getModelA();
    const first = new NumberCommand(MODELA_ID, (aNumber) => aNumber + 2);
    const second = new NumberCommand(MODELA_ID, (aNumber) => aNumber / 11);

    const composite = append(first, second);
    const execution = stack.execute(composite, MODELA_ID);

    const intermediateModelA = await first.executed.then(getModelA);
    await execution;

    const finalModelA = getModelA();

    expect(intermediateModelA).to.be.equal(initialModelA);
    expect(finalModelA).not.to.be.equal(initialModelA);
  });
});

async function pause(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

class NumberCommand implements SimpleCommand {
  readonly label: 'Modify aNumber';

  private patch?: Operation[];

  private resolveExecuted: () => void;
  public executed = new Promise<void>((resolve) => {
    this.resolveExecuted = resolve;
  });

  constructor(
    readonly modelId: string,
    private readonly computation: (input: number) => number
  ) {}

  async execute(model: object): Promise<Operation[]> {
    const modelA = model as typeof _modelA;
    const newNumber = this.computation(modelA.aNumber);

    // Yield execution to some other concurrent promise
    await pause();

    const patch: Operation[] = [
      { op: 'replace', path: '/aNumber', value: newNumber },
    ];
    const original = cloneDeep(modelA);
    applyPatch(modelA, patch);
    this.patch = compare(modelA, original, true);

    this.resolveExecuted();
    return patch;
  }

  private applyAndReversePatch(model: object): Operation[] {
    const original = cloneDeep(model);
    if (!this.patch) {
      throw new Error('Not yet executed');
    }
    const patch = this.patch;
    applyPatch(model, patch);
    this.patch = compare(model, original, true);
    return patch;
  }

  undo(model: object): Operation[] {
    return this.applyAndReversePatch(model);
  }

  redo(model: object): Operation[] {
    return this.applyAndReversePatch(model);
  }

  canExecute(): boolean {
    return !this.patch;
  }

  canUndo(): boolean {
    return !!this.patch;
  }

  canRedo(): boolean {
    return !!this.patch;
  }
}
