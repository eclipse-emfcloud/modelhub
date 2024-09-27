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
import { EditingContext } from '../core';

/**
 * Utility for execution of async functions that must be given mutually
 * exclusive access to some resource. Execution is chained: each async
 * call that is passed in for execution is deferred until the previous
 * has completed, whether normally or with an error.
 */
export class ExclusiveExecutor<K> {
  /**
   * Awaitable results of the current pending exclusive operations.
   * Initially there's nothing pending.
   */
  private locks: Lock<K>[] = [];

  /**
   * Exclusively run the given asynchronous `operation`, returning its
   * eventual result. Operations can be executed in parallel only if they
   * affect different models and editing contexts. If modelIds is not
   * specified, the operation is assumed to potentially affect any model,
   * and will not run in parallel with any other operation.
   *
   * @param operation an asynchronous operation to run exclusively
   * @param contexts the editing contexts affected by the operation
   * @param modelIds the identifier of models modified by the operation
   * @returns the eventual result of the `operation`
   */
  run<T>(
    operation: () => Promise<T>,
    contexts: EditingContext[],
    modelIds?: K[]
  ): Promise<T> {
    const dependentLock = this.getDependentLock(contexts, modelIds);
    const result = dependentLock.pendingExclusiveOperation.then(() =>
      operation()
    );

    // Don't propagate any error to the next caller in the chain
    const lockOperation = new Promise<void>((resolve) => {
      result.finally(resolve);
    });

    const lock: Lock<K> = {
      modelIds,
      contexts,
      pendingExclusiveOperation: lockOperation,
    };
    this.locks.push(lock);

    // Remove the lock after execution
    lock.pendingExclusiveOperation.finally(() => {
      const lockIndex = this.locks.indexOf(lock);
      this.locks.splice(lockIndex, 1);
    });

    return result;
  }

  private getDependentLock(
    contexts: EditingContext[],
    modelIds?: K[]
  ): Lock<K> {
    const waitForLocks: Promise<unknown>[] = [];

    if (modelIds === undefined) {
      // If the model ids are missing, lock all models. This is typically
      // the case for undo/redo operations, which we shouldn't be running
      // in parallel.
      waitForLocks.push(
        ...this.locks.map((lock) => lock.pendingExclusiveOperation)
      );
    } else {
      for (const lock of this.locks) {
        // If the editing contexts overlap, we need to wait for the previous operation.
        if (lock.contexts.some((context) => contexts.includes(context))) {
          waitForLocks.push(lock.pendingExclusiveOperation);
        } else {
          if (lock.modelIds === undefined) {
            // Wait for all operations that lock all models.
            waitForLocks.push(lock.pendingExclusiveOperation);
          } else {
            // If the model ids are present, only wait for overlapping locks.
            if (lock.modelIds.some((modelId) => modelIds.includes(modelId))) {
              waitForLocks.push(lock.pendingExclusiveOperation);
            }
          }
        }
      }
    }

    return {
      modelIds,
      contexts,
      pendingExclusiveOperation: Promise.allSettled(waitForLocks),
    };
  }
}

type Lock<K> = {
  modelIds?: K[];
  contexts: EditingContext[];
  pendingExclusiveOperation: Promise<unknown>;
};
