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

import { ExclusiveExecutor } from '../promise-util';

chai.use(chaiAsPromised);

const TEST_CONTEXT = 'test-context';

describe('ExclusiveExecutor', () => {
  let exec: ExclusiveExecutor<string>;

  beforeEach(() => {
    exec = new ExclusiveExecutor();
  });

  it('executes in the order posted', async () => {
    let x = 0;
    const a = exec.run(async () => ++x, [TEST_CONTEXT]);
    const b = exec.run(async () => ++x, [TEST_CONTEXT]);
    const c = exec.run(async () => ++x, [TEST_CONTEXT]);

    expect(a).to.eventually.be.equal(1);
    expect(b).to.eventually.be.equal(2);
    expect(c).to.eventually.be.equal(3);
  });

  it('does not leak exceptions', async () => {
    let x = 0;
    const a = exec.run(async () => ++x, [TEST_CONTEXT]);
    const b = exec.run(async () => {
      throw new Error();
    }, [TEST_CONTEXT]);
    const c = exec.run(async () => ++x, [TEST_CONTEXT]);

    expect(a).to.eventually.be.equal(1);
    expect(b).to.eventually.be.rejected;
    expect(c).to.eventually.be.equal(2);
  });

  it('gives each caller its exception', async () => {
    const a = exec.run(async () => {
      throw new Error('Boom!A');
    }, [TEST_CONTEXT]);
    const b = exec.run(async () => {
      throw new Error('Boom!B');
    }, [TEST_CONTEXT]);

    expect(a).to.eventually.be.rejectedWith('Boom!A');
    expect(b).to.eventually.be.rejectedWith('Boom!B');
  });

  it('try/catch usage is predictable', async () => {
    let aOK = false;
    let bOK = false;
    let cOK = false;

    try {
      await exec.run(async () => {
        throw new Error('Boom!A');
      }, [TEST_CONTEXT]);
    } catch (error) {
      aOK = error.message === 'Boom!A';
    }

    try {
      const b = await exec.run(async () => 'b'.toUpperCase(), [TEST_CONTEXT]);
      bOK = b === 'B';
    } catch (error) {
      bOK = false;
    }

    try {
      await exec.run(async () => {
        throw new Error('Boom!C');
      }, [TEST_CONTEXT]);
    } catch (error) {
      cOK = error.message === 'Boom!C';
    }

    expect(aOK).to.be.true;
    expect(bOK).to.be.true;
    expect(cOK).to.be.true;
  });

  it('waits for context dependencies', async () => {
    const operation1 = new MockOperation();
    const operation2 = new MockOperation();
    const operation3 = new MockOperation();

    // Operation 1 and 3 are completely independent and can run in parallel
    // Operation 2 depends on Operation 1 because they use the same context
    exec.run(() => operation1.run(), [TEST_CONTEXT], []);
    exec.run(() => operation2.run(), [TEST_CONTEXT], []);
    exec.run(() => operation3.run(), ['context2'], []);

    await flush();

    expect(operation1.state).to.equal('running');
    expect(operation2.state).to.equal('ready');
    expect(operation3.state).to.equal('running');

    await operation1.complete();

    expect(operation1.state).to.equal('complete');
    expect(operation2.state).to.equal('running');
    expect(operation3.state).to.equal('running');

    await operation3.complete();

    expect(operation2.state).to.equal('running');
    expect(operation3.state).to.equal('complete');

    await operation2.complete();

    expect(operation2.state).to.equal('complete');
  });

  it('waits for model dependencies', async () => {
    const operation1 = new MockOperation();
    const operation2 = new MockOperation();
    const operation3 = new MockOperation();

    // Operation 1 and 3 are completely independent and can run in parallel
    // Operation 2 depends on Operation 1 because they use the same model
    exec.run(() => operation1.run(), [TEST_CONTEXT], ['modelA']);
    exec.run(() => operation2.run(), ['context2'], ['modelC', 'modelA']);
    exec.run(() => operation3.run(), ['context3'], ['modelB']);

    await flush();

    expect(operation1.state).to.equal('running');
    expect(operation2.state).to.equal('ready');
    expect(operation3.state).to.equal('running');

    await operation1.complete();

    expect(operation1.state).to.equal('complete');
    expect(operation2.state).to.equal('running');
    expect(operation3.state).to.equal('running');

    await operation3.complete();

    expect(operation2.state).to.equal('running');
    expect(operation3.state).to.equal('complete');

    await operation2.complete();

    expect(operation2.state).to.equal('complete');
  });

  it('blocks any other operation', async () => {
    const operation1 = new MockOperation();
    const operation2 = new MockOperation();
    const operation3 = new MockOperation();

    // Operation 1 blocks everything else (e.g. Undo/Redo operation with no model id)
    // Operation 2 and Operation 3 are independent from each other and can run in parallel
    exec.run(() => operation1.run(), [TEST_CONTEXT]);
    exec.run(() => operation2.run(), ['context2'], ['modelC', 'modelA']);
    exec.run(() => operation3.run(), ['context3'], ['modelB', 'modelD']);

    await flush();

    expect(operation1.state).to.equal('running');
    expect(operation2.state).to.equal('ready');
    expect(operation3.state).to.equal('ready');

    await operation1.complete();

    expect(operation1.state).to.equal('complete');
    expect(operation2.state).to.equal('running');
    expect(operation3.state).to.equal('running');

    await operation3.complete();

    expect(operation2.state).to.equal('running');
    expect(operation3.state).to.equal('complete');

    await operation2.complete();

    expect(operation2.state).to.equal('complete');
  });
});

class MockOperation {
  private resolve: (value: unknown) => void;

  private result: Promise<unknown> = new Promise<unknown>((resolve) => {
    this.resolve = resolve;
  });

  public state: OperationState = 'ready';

  async run(): Promise<unknown> {
    this.state = 'running';
    return this.result;
  }

  async complete(value?: unknown): Promise<void> {
    if (this.state !== 'running') {
      throw new Error('Unexpected state: ' + this.state);
    }
    this.resolve(value);
    this.state = 'complete';
    await flush();
  }
}

type OperationState = 'ready' | 'running' | 'complete';

/**
 * Process the async queue. This is necessary to ensure then() is executed
 * as soon as possible after a promise completes. This way, we can
 * ensure that dependencies of operations are started before we run our
 * test assertions.
 */
async function flush() {
  await new Promise((resolve) => setTimeout(resolve));
}
