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
import { Operation, applyPatch, compare } from 'fast-json-patch';
import cloneDeep from 'lodash/cloneDeep';
import {
  CompoundCommandImpl,
  MaybePromise,
  SimpleCommand,
  SimpleCommandWithResult,
} from '../core';
/**
 * The type of a function that patches a model by direct modification of a working copy.
 *
 * The function may be synchronous or asynchronous.
 * Its return value, if any, will be made available to the client that executes the command.
 *
 * @param workingCopy a working copy of the model that the function shall modify directly
 * @param modelId the ID of the model to update
 * @returns a result of the original command execution, if anything useful is to be
 *     communicated back to the client that executes the command
 */
export type ModelUpdater<K, M extends object = object, R = unknown> = (
  workingCopy: M,
  modelId: K
) => MaybePromise<R>;

/**
 * The type of a function that computes a patch to modify a model.
 * The given `model` state must not be altered directly by the function
 * but may only be used to compute a patch.
 *
 * The function may be synchronous or asynchronous.
 *
 * @param model the model state on which to compute the patch
 * @param modelId the ID of the model for which to compute a patch
 * @return a patch that when applied to the `model` will effect the required changes
 */
export type ModelPatchFunction<K, M extends object = object> = (
  model: M,
  modelId: K
) => MaybePromise<Operation[]>;

/**
 * The type of a predicate function that determines whether, at the time of its invocation,
 * the given `model` is in a state that is valid to update according to the preconditions
 * of the model updating function accompanying it.
 *
 * @param model the model state on which preconditions of its updating are to be tested
 * @param modelId the ID of the `model`
 * @returns `true` if the update may be performed or a reason string if it must not.
 *   The reason string is included in the error message should an attempt to execute it be made
 * @see {@link ModelUpdater}
 * @see {@link createModelUpdaterCommand()}
 */
export type CanExecutePredicate<K, M extends object = object> = (
  model: M,
  modelId: K
) => MaybePromise<true | string>;

/**
 * Options for tuning the behaviour of a {@link PatchCommand}.
 * If omitted, all default options are inferred.
 */
export interface PatchCommandOptions<K> {
  /**
   * How to enforce (or not) preconditions of undo/redo, as implemented by
   * `test` operations in the computed JSON Patches computed.
   *
   * - `'strict'` (the default) will throw an error on precondition failure
   * - `'lax'` will simply log precondition failures at debug level
   *
   * @default 'strict'
   */
  preconditionsMode?: 'strict' | 'lax';

  /**
   * A predicate to test whether the command should be allowed to execute at the time of its invocation.
   * If not provided, then the command will be assumed executable.
   *
   * @default a trivially `true` predicate
   */
  canExecute?: CanExecutePredicate<K>;
}

/**
 * A {@link SimpleCommand} that executes a Json Patch on a Document.
 *
 * @template K the type of model ID used by the Model Manager
 */
export class PatchCommand<K = string> implements SimpleCommand<K> {
  private state: State = 'ready';

  /**
   * The model patch function that I use to compute the model patch to apply.
   */
  private readonly modelUpdater: ModelUpdater<K>;

  /**
   * The patch generated during execution, used to undo the changes
   * that were applied. Will be computed during execution.
   */
  private undoPatch: Operation[] | undefined;

  /**
   * The patch generated during execution, used to redo the changes
   * that were applied. Will be computed during execution.
   */
  private redoPatch: Operation[] | undefined;

  /**
   * Options, if supplied by the client, to tune my behaviour.
   */
  private options: Required<PatchCommandOptions<K>>;

  /**
   *
   * @param label The label of this command.
   * @param model The document to patch. This document will be modified when this command is executed/undone/redone.
   * @param patch The JSON Patch to apply on the document or (preferred) a function that updates a working copy of the model directly.
   * @param [options] The options, if any, to tune the behaviour of the command
   */
  constructor(
    public readonly label: string,
    public modelId: K,
    patch: Operation[] | ModelUpdater<K>,
    options: PatchCommandOptions<K> = {}
  ) {
    if (typeof patch === 'function') {
      this.modelUpdater = patch;
    } else {
      // Create a defensive copy of the patch now because we only use it later
      const myPatch = cloneDeep(patch);
      this.modelUpdater = (model) => this.applyPatchWithOptions(model, myPatch);
    }

    this.options = {
      preconditionsMode: 'strict',
      canExecute: () => true,
      ...options,
    };
  }

  /**
   * Query whether any preconditions that I may have for viable execution are met.
   * On a `true` result, I guarantee that I can effect my changes on the model correctly and completely.
   * Otherwise, it is an error to attempt to {@link execute} me.
   *
   * @param model the model on which I am to be executed
   * @param reasonCallback an optional call-back function that will be given the reason
   *     why the command cannot be executed, in the case that it is not executable
   * @returns whether I am able to be executed
   */
  async canExecute(
    model: object,
    reasonCallback?: (reason: string) => unknown
  ): Promise<boolean> {
    const okOrReason = !this.inState('ready')
      ? 'already executed'
      : await this.options.canExecute(model, this.modelId);
    if (okOrReason !== true) {
      reasonCallback?.(okOrReason);
      return false;
    }
    return okOrReason;
  }

  canUndo(_model: object): boolean {
    return this.inState('executed') && this.undoPatch !== undefined;
  }

  canRedo(_model: object): boolean {
    return this.inState('undone') && this.redoPatch !== undefined;
  }

  async execute(model: object): Promise<Operation[] | undefined> {
    // Don't need to check the return result because we throw if not executable
    await this.canExecute(model, (reason) => {
      throw new Error(
        `PatchCommand '${this.label}' cannot be executed: ${reason}`
      );
    });

    const initialDocument = cloneDeep(model);

    await this.modelUpdater(model, this.modelId);
    // The modelUpdater might have modified the model in an incompatible manner.
    // Transform the model to be JSON compatible to avoid problems with
    // undefined values in properties and arrays.
    jsonTransform(model);

    this.redoPatch = compare(initialDocument, model, true);
    this.undoPatch = compare(model, initialDocument, true);

    this.state = 'executed';

    return cloneDeep(this.redoPatch);
  }

  undo(model: object): Operation[] | undefined {
    if (!this.canUndo(model) || this.undoPatch === undefined) {
      throw new Error(`PatchCommand ${this.label} cannot be undone`);
    }

    // Maybe the model updater didn't make any changes, so check
    // whether the patch has anything to do
    if (this.undoPatch.length > 0) {
      this.applyPatchWithOptions(model, this.undoPatch);
    }

    this.state = 'undone';

    return cloneDeep(this.undoPatch);
  }

  redo(model: object): Operation[] | undefined {
    if (!this.canRedo(model) || this.redoPatch === undefined) {
      throw new Error(`PatchCommand ${this.label} cannot be redone`);
    }

    // Maybe the model updater didn't make any changes, so check
    // whether the patch has anything to do
    if (this.redoPatch.length > 0) {
      this.applyPatchWithOptions(model, this.redoPatch);
    }

    this.state = 'executed';

    return cloneDeep(this.redoPatch);
  }

  /**
   * Query whether I am in some `state`.
   *
   * @param state a state to query
   * @returns whether I am in the given `state`
   */
  private inState(state: State): boolean {
    return this.state === state;
  }

  /**
   * Apply the given `patch` to a `model` with accounting for the preconditions mode.
   */
  private applyPatchWithOptions(model: object, patch: Operation[]): void {
    // Every time we attempt to apply the `patch` we have to clone
    // that original again; we cannot reuse a clone of it for the retry
    // in case the first attempt modifies it

    try {
      applyPatch(model, cloneDeep(patch));
    } catch (error) {
      if (this.options.preconditionsMode === 'strict') {
        // Propagate to the caller
        throw error;
      }

      console.debug(
        'Inapplicable undo/redo patch. Re-trying without tests.',
        error
      );

      // Try again without the test assertions
      const noTests = cloneDeep(patch).filter((op) => op.op !== 'test');
      applyPatch(model, noTests);
    }
  }
}

export interface MultiPatchEntry<K = string> {
  modelId: K;
  patch: Operation[];
}

export class MultiPatchCommand<K = string> extends CompoundCommandImpl<K> {
  constructor(label: string, ...patches: MultiPatchEntry<K>[]) {
    super(
      label,
      ...patches.map(
        (entry) => new PatchCommand(label, entry.modelId, entry.patch)
      )
    );
  }
}

/**
 * A private enumeration of the states of a `PatchCommand`, used
 * for precondition checking on all of its operations.
 *
 * @enum State
 */
type State = 'ready' | 'executed' | 'undone';

/**
 * Create a command that invokes a model updater function at the
 * time of its execution to directly modify a model object,
 * automatically capturing a JSON Patch for undo/redo.
 * Upon successful execution, the `result` property of the returned
 * command is set to the return result of the `modelUpdater` function
 * that computed the model changes.
 *
 * @param label a user-presentable label for the command
 * @param modelId the ID of the model to be modified
 * @param modelUpdater a function that will directly modify a working copy of the model
 * @param [options] options, if any, to tune the behaviour of the command
 *
 * @returns the undoable model updater command with a `result` that is `undefined` until the command
 *   has been executed
 */
export const createModelUpdaterCommandWithResult = <K, M extends object, R>(
  label: string,
  modelId: K,
  modelUpdater: ModelUpdater<K, M, R>,
  options?: PatchCommandOptions<K>
): SimpleCommandWithResult<K, R> => {
  let _result: R | undefined;
  const delegate: ModelUpdater<K, M> = async (workingCopy, modelId) => {
    _result = await modelUpdater(workingCopy, modelId);
  };

  return new (class extends PatchCommand<K> {
    get result(): R | undefined {
      return _result;
    }
  })(label, modelId, delegate, options);
};

/**
 * Create a command that invokes a model updater function at the
 * time of its execution to directly modify a model object,
 * automatically capturing a JSON Patch for undo/redo.
 *
 * @param label a user-presentable label for the command
 * @param modelId the ID of the model to be modified
 * @param modelUpdater a function that will directly modify a working copy of the model
 * @param [options] options, if any, to tune the behaviour of the command
 *
 * @returns the undoable model updater command
 */
export const createModelUpdaterCommand = <K, M extends object>(
  label: string,
  modelId: K,
  modelUpdater: ModelUpdater<K, M>,
  options?: PatchCommandOptions<K>
): SimpleCommand<K> => {
  return new PatchCommand(label, modelId, modelUpdater, options);
};

/**
 * Create a command that invokes a model function at the time of
 * its execution to compute a JSON Patch to apply to the model.
 * The computed patch is then used to modify the model.
 *
 * @param label a user-presentable label for the command
 * @param modelId the ID of the model to be modified
 * @param patchFunction a function that will compute the patch to apply
 * @param @param [options] options, if any, to tune the behaviour of the command
 *
 * @returns the undoable model patch command
 */
export const createModelPatchCommand = <K, M extends object>(
  label: string,
  modelId: K,
  patchFunction: ModelPatchFunction<K, M>,
  options?: PatchCommandOptions<K>
): SimpleCommand<K> => {
  return createModelUpdaterCommand<K, M>(
    label,
    modelId,
    async (workingCopy, theModelId) => {
      const patch = await patchFunction(workingCopy, theModelId);
      applyPatch(workingCopy, cloneDeep(patch));
    },
    options
  );
};

export type JSONCompatible<T> = T extends Array<infer U>
  ? Array<JSONCompatible<U>>
  : T extends object
  ? { [P in keyof T]: JSONCompatible<T[P]> }
  : T extends undefined
  ? never
  : T;

/**
 * Transforms an arbitrary Javascript object in place to be JSON compatible.
 * The goal is to behave similar to `JSON.parse(JSON.stringify(obj))`.
 *
 * The following transformations are applied:
 * - Removes properties whose value is `undefined`
 * - Converts `undefined` array values to `null`
 *
 * Will throw an error for recursive objects.
 */
export const jsonTransform = <T extends object>(obj: T): JSONCompatible<T> => {
  const visited = new Set();

  const traverse = <T>(current: T): JSONCompatible<T> => {
    if (visited.has(current)) {
      throw new Error(
        "model can't be processed because it has recursive references"
      );
    }

    if (current && typeof current === 'object') {
      visited.add(current);

      if (Array.isArray(current)) {
        current.forEach((value, index) => {
          if (value === undefined) {
            current[index] = null;
          } else {
            jsonTransform(value);
          }
        });
        visited.delete(current);
        // A transformation of an object to another in place can't be properly typed,
        // therefore we manually confirm that we did our job
        return current as JSONCompatible<T>;
      }

      for (const key in current) {
        const value = current[key];
        if (value === undefined) {
          delete current[key];
        } else {
          // A transformation of an object to another in place can't be properly typed,
          // therefore pretend that nothing is changed type wise so that Typescript is satisfied
          current[key] = traverse(value) as typeof value;
        }
      }
      visited.delete(current);
    }

    // A transformation of an object to another in place can't be properly typed,
    // therefore we manually confirm that we did our job
    return current as JSONCompatible<T>;
  };

  return traverse(obj);
};
