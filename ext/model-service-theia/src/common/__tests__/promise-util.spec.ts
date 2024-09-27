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
import sinon from 'sinon';
import sinonChai from 'sinon-chai';

import { delay } from '@theia/core/lib/common/promise-util';
import { retryUntilFulfilled, timeout } from '../promise-util';

chai.use(sinonChai);
chai.use(chaiAsPromised);

describe('timeout', async () => {
  it('completes in time', async () => {
    const wrapped = delay(1)(42);
    const promise = timeout(wrapped);
    await expect(promise).eventually.to.equal(42);
  });

  it('times out', async () => {
    const wrapped = delay(5000)(42);
    const promise = timeout(wrapped, 25);
    await expect(promise).eventually.to.be.rejectedWith('Promise timed out.');
  });

  it('propagates failure', async () => {
    const wrapped = Promise.reject(new Error('as intended'));
    const promise = timeout(wrapped);
    await expect(promise).eventually.to.be.rejectedWith('as intended');
  });

  it('short-cuts immediate timeouts', async () => {
    const promise = timeout(delay(1)(42), 0);
    await expect(promise).eventually.to.be.rejectedWith('Promise timed out.');
  });

  describe('call-backs', () => {
    it('completes in time', async () => {
      const cb = sinon.stub();
      const wrapped = delay(1)(42);
      const promise = timeout(wrapped, 1000, cb);
      await expect(promise).eventually.to.be.fulfilled;
      expect(cb).to.have.been.calledWith(42);
    });

    it('times out', async () => {
      const cb = sinon.stub();
      const wrapped = delay(5000)(42);
      const promise = timeout(wrapped, 25, cb);
      await expect(promise).eventually.to.be.rejected;
      expect(cb).to.have.been.calledWith('timeout');
    });

    it('propagates failure', async () => {
      const cb = sinon.stub();
      const wrapped = Promise.reject(new Error('as intended'));
      const promise = timeout(wrapped, 1000, cb);
      await expect(promise).eventually.to.be.rejected;
      expect(cb).to.have.been.calledWithMatch({ message: 'as intended' });
    });

    it('timeout message', async () => {
      const cb = sinon.stub().returns('custom message');
      const wrapped = delay(5000)(42);
      const promise = timeout(wrapped, 25, cb);
      await expect(promise).eventually.to.be.rejectedWith('custom message');
    });

    it('short-cuts immediate timeouts', async () => {
      const cb = sinon.stub().returns('custom message');
      const promise = timeout(delay(1)(42), -100, cb);
      await expect(promise).eventually.to.be.rejectedWith('custom message');
      expect(cb).to.have.been.calledWith('timeout');
    });
  });
});

describe('retryUntilFulfilled', async () => {
  it('succeeds on first try', async () => {
    const wrapped = delay(1)(42);
    const promise = retryUntilFulfilled(() => wrapped);
    await expect(promise).eventually.to.equal(42);
  });

  it('succeeds on second first try', async () => {
    const stub = sinon
      .stub()
      .onFirstCall()
      .callsFake(() => Promise.reject(new Error('Boom!')))
      .callsFake(() => delay(1)(42));

    const promise = retryUntilFulfilled(stub);
    await expect(promise).eventually.to.equal(42);
  });

  describe('with explicit timeout', () => {
    it('succeeds on first try', async () => {
      const wrapped = delay(1)(42);
      const promise = retryUntilFulfilled(() => timeout(wrapped, 100));
      await expect(promise).eventually.to.equal(42);
    });

    it('succeeds on second first try', async () => {
      const stub = sinon
        .stub()
        .onFirstCall()
        .callsFake(() => Promise.reject(new Error('Boom!')))
        .callsFake(() => delay(1)(42));

      const promise = retryUntilFulfilled(() => timeout(stub(), 100));
      await expect(promise).eventually.to.equal(42);
    });

    it('times out', async () => {
      const wrapped = delay(5000)(42);
      const promise = retryUntilFulfilled(() => timeout(wrapped, 75));
      await expect(promise).eventually.to.be.rejectedWith('Promise timed out.');
    });

    it('times out with call-back', async () => {
      const cb = sinon.stub().returns('custom message');
      const wrapped = delay(5000)(42);
      const promise = retryUntilFulfilled(() => timeout(wrapped, 75, cb));
      await expect(promise).eventually.to.be.rejectedWith('custom message');
      expect(cb).to.have.been.calledWith('timeout');
    });

    it('propagates failure', async () => {
      const wrapped = Promise.reject(new Error('as intended'));
      const promise = retryUntilFulfilled(() => timeout(wrapped, 75));
      await expect(promise).eventually.to.be.rejectedWith('as intended');
    });

    it('short-cuts settled promises', async () => {
      const wrapped = timeout(delay(1)(42), 100);
      await wrapped;
      const promise = retryUntilFulfilled(() => wrapped);
      await expect(promise).eventually.to.equal(42);
    });

    it('short-cuts settled promises with call-back', async () => {
      const cb = sinon.stub();
      const wrapped = timeout(delay(1)(42), 100, cb);
      await wrapped;
      const promise = retryUntilFulfilled(() => wrapped);
      await expect(promise).eventually.to.equal(42);
      expect(cb).to.have.been.calledWith(42);
    });

    it('unwraps a failed retry', async () => {
      const failed = timeout(
        ''.length === 0
          ? Promise.reject(new Error('Boom!'))
          : Promise.resolve(),
        15
      );

      const stub = sinon
        .stub()
        .onFirstCall()
        .callsFake(() => timeout(Promise.reject(new Error('Boom!')), 75))
        .callsFake(() => failed);

      const promise = retryUntilFulfilled(stub);
      await expect(promise).eventually.to.be.rejectedWith('Boom!');
    });

    it('unwraps a timed-out retry', async () => {
      const timedOut = timeout(delay(75)(42), 15);

      const stub = sinon
        .stub()
        .onFirstCall()
        .callsFake(() => timeout(Promise.reject(new Error('Boom!')), 75))
        .callsFake(() => timedOut);

      const promise = retryUntilFulfilled(stub);
      await expect(promise).eventually.to.be.rejectedWith('Boom!');
    });

    it('unwraps a completed retry', async () => {
      const completed = timeout(delay(15)(42), 15);

      const stub = sinon
        .stub()
        .onFirstCall()
        .callsFake(() => timeout(Promise.reject(new Error('Boom!')), 75))
        .callsFake(() => completed);

      const promise = retryUntilFulfilled(stub);
      await expect(promise).eventually.to.be.equal(42);
    });
  });
});
