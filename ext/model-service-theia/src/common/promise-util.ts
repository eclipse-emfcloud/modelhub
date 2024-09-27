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

import { CancellationError, Emitter } from '@theia/core';
import { wait, waitForEvent } from '@theia/core/lib/common/promise-util';

const DEFAULT_TIMEOUT = 30_000;

const stateProp = Symbol('state');

/** Protocol of the optional call-back function in the promise {@link timeout()} API. */
export type TimeoutHandler<T> = (
  reason: 'timeout' | T | Error
) => string | undefined;

type TimeoutPending<T> = {
  state: 'pending';
  promise: Promise<T>;
  timeoutMillis: number;
  callback?: TimeoutHandler<T>;
};
type TimedOut = { state: 'timeout' };
type Failed = { state: 'failed'; reason: Error };
type Completed<T> = { state: 'completed'; result: T };
type TimeoutPromiseState<T> =
  | TimeoutPending<T>
  | TimedOut
  | Failed
  | Completed<T>;
type TimeoutPromise<T> = Promise<T> & { [stateProp]: TimeoutPromiseState<T> };
type PendingPromise<T> = Promise<T> & { [stateProp]: TimeoutPending<T> };

class TimeoutError extends Error {
  constructor(message?: string) {
    super(message ?? 'Promise timed out.');
  }
}

/**
 * Wrap a promise in a timeout that will reject if the promised value
 * is not provided within a given number of milliseconds.
 *
 * @param promise the promise to wrap
 * @param an optional timeout, in milliseconds. If not specified, the default is 30 seconds
 * @param callback an optional call-back to be invoked on completion of the wrapped provider
 * either by success, failure, or timeout. If it returns a string, it will be used for the
 * message of the returned promise's rejection error (if applicable)
 */
export function timeout<T>(
  promise: Promise<T>,
  timeout?: number,
  callback?: TimeoutHandler<T>
): Promise<T> {
  const provided = new Emitter<T | Error>();
  const timeoutMillis = timeout ?? DEFAULT_TIMEOUT;

  if (timeoutMillis <= 0) {
    // Already timed out
    return Promise.reject(new TimeoutError(callback?.('timeout')));
  }

  const result: PendingPromise<T> = setState(
    waitForEvent(provided.event, timeoutMillis)
      .then(
        /* completed on time or failed */ (outcome) => {
          invokeCallback(
            result,
            // whether failing by error or completing normally, it didn't time out
            outcome
          );
          if (outcome instanceof Error) {
            throw outcome;
          }
          setState(result, { state: 'completed', result: outcome });
          return outcome;
        }
      )
      .catch((error) => {
        /* timed out or failed */
        if (!(error instanceof CancellationError)) {
          // Initialization failed
          setState(result, { state: 'failed', reason: error });
          throw error;
        }

        // Timed out
        const message = invokeCallback(result, 'timeout');
        setState(result, { state: 'timeout' });
        throw new TimeoutError(message);
      })
      .finally(() => provided.dispose()),
    <TimeoutPending<T>>{
      state: 'pending',
      promise,
      timeoutMillis,
      callback,
    }
  );

  // Attempt to await the provided value
  promise
    .then((result) => provided.fire(result))
    .catch((error) => provided.fire(error));

  return result;
}

function isTimeoutPromise<T>(
  promise: Promise<T>
): promise is TimeoutPromise<T> {
  return stateProp in promise;
}

export async function retryUntilFulfilled<T>(fn: () => Promise<T>): Promise<T> {
  const timeoutPromise = wrap(fn());
  if (timeoutPromise[stateProp].state !== 'pending') {
    // If it has already completed, there's nothing to retry
    return timeoutPromise;
  }

  const { promise, timeoutMillis, callback } = timeoutPromise[stateProp];

  // Don't let the then/catch clauses attached by the timeout() function
  // invoke the call-back because we'll do it, ourselves
  timeoutPromise[stateProp].callback = undefined;
  const retryDelay = retryInterval(timeoutMillis);

  let nonTimeoutFailure: Error | undefined;
  let remainingTimeout = timeoutMillis;
  let nextTry = promise;

  for (;;) {
    try {
      const result = await timeout(nextTry, remainingTimeout);
      callback?.(result);
      return result;
    } catch (error) {
      if (error instanceof TimeoutError) {
        // Timed out. Give up
        if (nonTimeoutFailure !== undefined) {
          callback?.(nonTimeoutFailure);
          throw nonTimeoutFailure;
        } else {
          throw new TimeoutError(callback?.('timeout'));
        }
      }
      nonTimeoutFailure = error;

      // Try again
      remainingTimeout -= retryDelay;
      await wait(retryDelay);
      nextTry = unwrap(fn());
    }
  }
}

// re-try three times per second-or-less
function retryInterval(timeoutMillis: number): number {
  return timeoutMillis > 1000 ? 300 : timeoutMillis / 3.5;
}

/** Wrap a promise as a timeout promise if it isn't already one. */
function wrap<T>(promise: Promise<T>): TimeoutPromise<T> {
  return isTimeoutPromise(promise)
    ? promise
    : (timeout(promise) as TimeoutPromise<T>);
}

/** Unwrap a timeout promise to retrieve the underlying promise. */
function unwrap<T>(promise: Promise<T>): Promise<T> {
  if (!isTimeoutPromise(promise)) {
    return promise;
  }

  const state = promise[stateProp];
  switch (state.state) {
    case 'pending':
      // Don't let the then/catch clauses attached by the timeout() function
      // invoke the call-back because we'll do it, ourselves
      state.callback = undefined;
      return state.promise;
    case 'failed':
      return Promise.reject(state.reason);
    case 'completed':
      return Promise.resolve(state.result);
    default:
      return Promise.reject(new TimeoutError());
  }
}

/**
 * Invoke the call-function attached to a timeout `promise`, if it has one.
 *
 * @param promise the timeout promise on which to invoke the call-back
 * @param args the arguments to the call-back function
 * @returns the return result of the call-back, if there is one
 */
function invokeCallback<T>(
  promise: PendingPromise<T>,
  ...args: Parameters<TimeoutHandler<T>>
): ReturnType<TimeoutHandler<T>> {
  return promise[stateProp].callback?.(...args);
}

/**
 * Update the state of a timeout-promise.
 *
 * @param promise the promise on which to update the timeout state
 * @param state the state to set
 * @return the updated `promise`
 */
function setState<T, S extends TimeoutPromiseState<T>>(
  promise: Promise<T>,
  state: S
): Promise<T> & { [stateProp]: typeof state } {
  return Object.assign(promise, { [stateProp]: state });
}
