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

import type { Operation } from 'fast-json-patch';
import { MaybePromise } from './promises';

/**
 * An union of _command_ types that can be executed on a {@link CoreCommandStack} to edit a model.
 *
 * @template K the type of model ID used by the Model Manager
 */
export type Command<K = string> = SimpleCommand<K> | CompoundCommand<K>;

/**
 * The return result of an atomic command execution, undo, or redo is a possibly asynchronous
 * delta describing the effected model changes, or nothing.
 */
export type SimpleCommandResult = MaybePromise<Operation[] | undefined>;

/**
 * A command may optionally publish a `result` of its execution not in detailed JSON Patch terms but
 * in an abstract result type. This interface distinguishes such commands.
 */
export interface SimpleCommandWithResult<K, R> extends SimpleCommand<K> {
  /**
   * The abstract result of the command, available once it has been successfully executed.
   * The value is `undefined` until the command is executed.
   *
   * Whether the `result` value remains available or valid after the command is undone or redone
   * is not specified. In general, it is recommended only to access this result after the initial
   * execution of the command.
   *
   * @see {@link SimpleCommand.execute}
   */
  readonly result: R | undefined;
}

/**
 * Query whether a command is a simple command publishing an abstract execution result.
 */
export const isSimpleCommandWithResult = <K, R>(
  command: Command<K>
): command is SimpleCommandWithResult<K, R> => {
  return (
    !isCompoundCommand(command) &&
    Object.prototype.hasOwnProperty.call(command, 'result')
  );
};

/**
 * An operation that edits a model and may (conditionally) be undone to
 * revert its changes and redone to restore its changes.
 *
 * @template K the type of model ID used by the Model Manager
 */
export interface SimpleCommand<K = string> {
  /**
   * A label for the command that may be presented to the user in an UI, used to identify it in logs, etc.
   *
   * @readonly
   */
  readonly label: string;

  /**
   * The model affected by this command.
   *
   * @readonly
   */
  readonly modelId: K;

  /**
   * Query whether any preconditions that I may have for viable execution are met.
   * On a `true` result, I guarantee that I can effect my changes on the model correctly and completely.
   * Otherwise, it is an error to attempt to {@link execute} me.
   *
   * @param model the model on which I am to be executed
   * @returns whether I am able to be executed
   */
  canExecute(model: object): MaybePromise<boolean>;

  /**
   * Query whether any preconditions that I may have for viable undo are met.
   * On a `true` result, I guarantee that I can revert my previously executed changes on the model correctly and completely.
   * Otherwise, it is an error to attempt to {@link undo} me.
   *
   * @param model the model on which I am to be undone
   * @returns whether I am able to be undone
   */
  canUndo(model: object): MaybePromise<boolean>;

  /**
   * Query whether any preconditions that I may have for viable redo are met.
   * On a `true` result, I guarantee that I can re-apply my previously undone changes on the model correctly and completely.
   * Otherwise, it is an error to attempt to {@link redo} me.
   *
   * @param model the model on which I am to be redone
   * @returns whether I am able to be redone
   */
  canRedo(model: object): MaybePromise<boolean>;

  /**
   * Perform my changes on the model.
   *
   * If the changes that I make can be expressed as a JSON patch, the result is that patch.
   * In this case, the patch is applicable to the "before state" of the model, the state it was in before I was executed.
   *
   * @param model the model on which I am to be executed
   * @returns a JSON patch describing the changes that I performed, if they can be described in those terms
   * @throws if I am {@link canExecute not executable} according to my preconditions
   */
  execute(model: object): SimpleCommandResult;

  /**
   * Revert the changes that I had previously {@link execute}d on the model.
   *
   * If the changes that I make in this reversion can be expressed as a JSON patch, the result is that patch.
   * In this case, the patch is applicable to the "before state" of the model, the state it was in before I was undone
   * and therefore by implication the state it was in after I was originally executed.
   *
   * @param model the model on which I am to be undone
   * @returns a JSON patch describing the changes that I performed, if they can be described in those terms
   * @throws if I am {@link canUndo not undoable} according to my preconditions
   */
  undo(model: object): SimpleCommandResult;

  /**
   * Restore the changes that I had previously {@link undo}ne on the model.
   *
   * If the changes that I make in this restoration can be expressed as a JSON patch, the result is that patch.
   * In this case, the patch is applicable to the "before state" of the model, the state it was in before I was redone
   * and therefore by implication the state it was in after I was originally undone.
   *
   * @param model the model on which I am to be redone
   * @returns a JSON patch describing the changes that I performed, if they can be described in those terms
   * @throws if I am {@link canRedo not redoable} according to my preconditions
   */
  redo(model: object): SimpleCommandResult;
}

/**
 * The result of a compound command is a promised (future)
 * mapping of deltas describing the effected model changes of each
 * constituent atomic command, or nothing.
 */
export type CompoundCommandResult<K = string> = Promise<
  Map<Command<K>, Operation[]> | undefined
>;

type GetModel<K> = (modelId: K) => object | undefined;

/**
 * An operation that edits a model by composition of one or more steps implemented by commands
 * and that may (conditionally) be undone to revert its changes and redone to restore its changes.
 *
 * Compound commands are iterable, returning their constituent leaf simple commands in forward
 * execution order. Iteration is depth-first over a tree of nested compounds.
 *
 * @template K the type of model ID used by the Model Manager
 * @interface CompoundCommand
 */
export interface CompoundCommand<K = string>
  extends Iterable<SimpleCommand<K>> {
  /**
   * A label for the command that may be presented to the user in an UI, used to identify it in logs, etc.
   *
   * @readonly
   */
  readonly label: string;

  /**
   * Append some number of commands to the list that I will {@link execute}.
   * Once I have been executed, my commands are frozen and may no longer be appended.
   *
   * @param commands commands to append to me
   * @returns myself, for convenience of call chaining
   * @throws if I have already been {@link execute}d
   */
  append(...commands: Command<K>[]): this;

  /**
   * Query the commands that comprise me, in the order in which they are executed.
   * The returned array is a copy and may freely be modified by the caller.
   *
   * @returns my constituent commands
   */
  getCommands(): Command<K>[];

  /**
   * Query whether any preconditions that I may have for viable execution are met.
   * At a minimum, this is a conjunction of the executability of my constituent commands.
   *
   * On a `true` result, I guarantee that I can effect my changes on the model correctly and completely.
   * Otherwise, it is an error to attempt to {@link execute} me.
   *
   * @param getModel a function providing the models on which I shall execute my sub-commands
   * @returns whether I am able to be executed
   */
  canExecute(getModel: GetModel<K>): Promise<boolean>;

  /**
   * Query whether any preconditions that I may have for viable undo are met.
   * At a minimum, this is a conjunction of the undoability of my constituent commands.
   *
   * On a `true` result, I guarantee that I can revert my previously executed changes on the model correctly and completely.
   * Otherwise, it is an error to attempt to {@link undo} me.
   *
   * @param getModel a function providing the models on which I shall undo my sub-commands
   * @returns whether I am able to be undone
   */
  canUndo(getModel: GetModel<K>): Promise<boolean>;

  /**
   * Query whether any preconditions that I may have for viable redo are met.
   * At a minimum, this is a conjunction of the redoability of my constituent commands.
   *
   * On a `true` result, I guarantee that I can re-apply my previously undone changes on the model correctly and completely.
   * Otherwise, it is an error to attempt to {@link redo} me.
   *
   * @param getModel a function providing the models on which I shall redo my sub-commands
   * @returns whether I am able to be redone
   */
  canRedo(getModel: GetModel<K>): Promise<boolean>;

  /**
   * Perform my changes on the model by execution, in forward order, of my constituent commands.
   *
   * If the changes that I make can be expressed as a JSON patch, the result is that patch.
   * In this case, the patch is applicable to the "before state" of the model, the state it was in before I was executed.
   *
   * @param getModel a function providing the models on which I shall execute my sub-commands
   * @returns a mapping of JSON patches describing the changes performed by my constituent commands,
   * if they can be described in those terms
   * @throws if I am [not executable]{@link canExecute} according to my preconditions
   */
  execute(getModel: GetModel<K>): CompoundCommandResult<K>;

  /**
   * Revert the changes that I had previously {@link execute}d on the model by undo, in reverse order, of my constituent commands.
   *
   * If the changes that I make in this reversion can be expressed as a JSON patch, the result is that patch.
   * In this case, the patch is applicable to the "before state" of the model, the state it was in before I was undone
   * and therefore by implication the state it was in after I was originally executed.
   *
   * @param getModel a function providing the models on which I shall undo my sub-commands
   * @returns a mapping of JSON patches describing the changes that I performed, if they can be described in those terms
   * @throws if I am [not undoable]{@link canUndo} according to my preconditions
   */
  undo(getModel: GetModel<K>): CompoundCommandResult<K>;

  /**
   * Restore the changes that I had previously {@link undo}ne on the model by redo, in forward order, of my constituent commands.
   *
   * If the changes that I make in this restoration can be expressed as a JSON patch, the result is that patch.
   * In this case, the patch is applicable to the "before state" of the model, the state it was in before I was redone
   * and therefore by implication the state it was in after I was originally undone.
   *
   * @param getModel a function providing the models on which I shall redo my sub-commands
   * @returns a mapping of JSON patches describing the changes that I performed, if they can be described in those terms
   * @throws if I am [not redoable]{@link canRedo} according to my preconditions
   */
  redo(getModel: GetModel<K>): CompoundCommandResult<K>;

  /**
   * Iterate my constituent commands in execution order, applying a processor to each.
   *
   * @param processor the processor function
   */
  forEach(processor: (item: SimpleCommand<K>, index: number) => void): void;

  /**
   * Iterate my constituent commands in execution order, applying a transformation to
   * each and returning the results.
   *
   * @template T the result type of the transformation function
   *
   * @param transform the transformation function
   * @returns the transformation results
   */
  map<T>(transform: (item: SimpleCommand<K>, index: number) => T): T[];
}

/**
 * An actually asynchronous {@linkplain CompoundCommandResult compound command result}.
 */
export type CommandResult<K = string> = Promise<
  Map<Command<K>, Operation[]> | undefined
>;

/**
 * A private enumeration of the states of a `CompoundCommand`, used
 * for precondition checking on all of its operations.
 *
 * @enum State
 */
type State = 'ready' | 'executed' | 'undone';

/**
 * A basic implementation of the `CompoundCommand` interface suitable for most uses.
 *
 * @class CompoundCommandImpl
 */
export class CompoundCommandImpl<K = string> implements CompoundCommand<K> {
  protected readonly _label: string;
  protected readonly _commands: Command<K>[];
  protected state: State = 'ready';

  constructor(label: string, ...commands: Command<K>[]) {
    this._label = label;
    this._commands = [...commands];
  }

  get label(): string {
    return this._label;
  }

  /** Query whether I am in the "ready" (not yet executed, undone, or redone) state. */
  protected isReady(): boolean {
    return this.inState('ready');
  }

  canExecute(getModel: GetModel<K>): Promise<boolean> {
    return !this.isReady()
      ? Promise.resolve(false)
      : this.everyCommand((c) => {
          if (isCompoundCommand(c)) {
            return c.canExecute(getModel);
          }
          const model = getModel(c.modelId);
          return !!model && c.canExecute(model);
        });
  }

  /** Query whether I am in the "executed" (or redone) state. */
  protected wasExecuted(): boolean {
    return this.inState('executed');
  }

  canUndo(getModel: GetModel<K>): Promise<boolean> {
    return !this.wasExecuted()
      ? Promise.resolve(false)
      : this.everyCommand((c) => {
          if (isCompoundCommand(c)) {
            return c.canUndo(getModel);
          }
          const model = getModel(c.modelId);
          return !!model && c.canUndo(model);
        });
  }

  /** Query whether I am in the "undone" state. */
  protected wasUndone(): boolean {
    return this.inState('undone');
  }

  canRedo(getModel: GetModel<K>): Promise<boolean> {
    return !this.wasUndone()
      ? Promise.resolve(false)
      : this.everyCommand((c) => {
          if (isCompoundCommand(c)) {
            return c.canRedo(getModel);
          }
          const model = getModel(c.modelId);
          return !!model && c.canRedo(model);
        });
  }

  async execute(getModel: GetModel<K>): CommandResult<K> {
    await this.checkState('execute', 'ready', this.canExecute(getModel));

    const result = await this.iterateCommands('execute', getModel);
    this.state = 'executed';

    return result;
  }

  async undo(getModel: GetModel<K>): CommandResult<K> {
    await this.checkState('undo', 'executed', this.canUndo(getModel));

    const result = await this.iterateCommands('undo', getModel);
    this.state = 'undone';

    return result;
  }

  async redo(getModel: GetModel<K>): CommandResult<K> {
    await this.checkState('redo', 'undone', this.canRedo(getModel));

    const result = await this.iterateCommands('redo', getModel);
    this.state = 'executed';

    return result;
  }

  append(...commands: Command<K>[]): this {
    if (!this.inState('ready')) {
      throw new Error('Cannot append to executed compound.');
    }

    this._commands.push(...commands);
    return this;
  }

  getCommands(): Command<K>[] {
    return [...this._commands];
  }

  /**
   * Compute the conjunction of a possibly asynchronous `predicate` over all of my constituent commands.
   *
   * @param predicate a test to apply to each command in turn
   * @returns the conjunction of the `predicate` results for every command, or `false` if I have no commands
   */
  protected async everyCommand(
    predicate: (command: Command<K>) => MaybePromise<boolean>
  ): Promise<boolean> {
    if (!this._commands.length) {
      return false;
    }

    for (const command of this._commands) {
      const current = await predicate(command);
      if (!current) {
        return current;
      }
    }

    return true;
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
   * Guard the invocation of some operation by preconditions of `state` and other
   * arbitrary conditions.
   *
   * @param op the name of the operation being guarded
   * @param state the state in which I must be for valid invocation of the operation
   * @param canDo whether other preconditions for the operation are met
   *
   * @throws if either I am not in the given `state` or `canDo` is `false`
   */
  private async checkState(
    op: string,
    state: State,
    canDo: MaybePromise<boolean>
  ): Promise<void> {
    if (!this.inState(state)) {
      throw new Error(`Cannot ${op}: not in the correct state`);
    }

    if (!(await canDo)) {
      throw new Error(`Cannot ${op}`);
    }
  }

  [Symbol.iterator](): Iterator<SimpleCommand<K>> {
    return new CompoundCommandIterator(this);
  }

  forEach(processor: (item: SimpleCommand<K>, index: number) => void): void {
    let index = 0;
    for (const next of this) {
      processor(next, index++);
    }
  }

  map<T>(transform: (item: SimpleCommand<K>, index: number) => T): T[] {
    const result: T[] = [];
    this.forEach((next, index) => result.push(transform(next, index)));
    return result;
  }

  /**
   * Iterate over my commands, applying an execute/undo/redo operation on each, and collecting the results.
   *
   * The iteration order depends on my current state: if I have been executed or redone, then iteration is backwards
   * from my last subcommand to my first, because the operation that I can perform is an undo.
   * Otherwise, the order is forwards from my first subcommand to my last.
   *
   * The result is `undefined` if all of my subcommands returned an `undefined` result.
   * Otherwise, it is a mapping of subcommands to their results, for those that returned some result.
   *
   * @param operation the operation to invoke on my commands
   * @param getModel a function providing the models on which I shall execute/undo/redo my sub-commands
   * @returns the aggregate results of the `operation` over my commands, if available
   */
  private async iterateCommands(
    operation: 'execute' | 'undo' | 'redo',
    getModel: GetModel<K>
  ): Promise<Map<Command<K>, Operation[]> | undefined> {
    // The direction to iterate the commands depends on whether we are undoing them or now
    const commands =
      operation === 'undo' ? [...this._commands].reverse() : this._commands;

    const result: Map<Command<K>, Operation[]> = new Map();

    // Rewind changes already done in case of failure
    const rewind = async (from: number) => {
      // Rewind in reverse order, not including the one that failed
      const recover = commands.slice(0, from).reverse();
      const revert = operation === 'undo' ? 'redo' : 'undo';
      // Best-effort all the way
      for (const command of recover) {
        try {
          if (isCompoundCommand(command)) {
            await command[revert](getModel);
          } else {
            const model = getModel(command.modelId);
            if (!model) {
              throw new Error(`No model on which to ${revert} command.`);
            }
            await command[revert](model);
          }
        } catch (error) {
          console.error(
            `Error in recovery of failed ${operation}. Continuing best-effort rewind.`,
            error
          );
        }
      }
    };

    for (let i = 0; i < commands.length; i++) {
      const command = commands[i];

      try {
        let delta: Awaited<SimpleCommandResult | CommandResult<K>>;
        if (isCompoundCommand(command)) {
          delta = await command[operation](getModel);
        } else {
          const model = getModel(command.modelId);
          if (!model) {
            throw new Error(`No model on which to ${operation} command.`);
          }
          delta = await command[operation](model);
        }

        if (delta instanceof Map) {
          for (const [subCommand, subDelta] of delta.entries()) {
            result.set(subCommand, subDelta);
          }
        } else if (delta) {
          result.set(command, delta);
        }
      } catch (error) {
        await rewind(i);
        throw error;
      }
    }

    return result.size ? result : undefined;
  }
}

/**
 * Type guard determining whether a `command` is a `CompoundCommand`.
 *
 * @function
 * @param command a command
 * @returns whether the `command` is a `CompoundCommand`
 */
export const isCompoundCommand = <K = string>(
  command: Command<K>
): command is CompoundCommand<K> => {
  return 'append' in command && typeof command.append === 'function';
};

/**
 * Append zero or more commands to a `base` command.
 *
 * If the `commands` to append are none, then the `base` is returned as is.
 *
 * If the `base` command is already a compound, it is appended in place and returned.
 * Otherwise, a new `CompoundCommand` is created from all of the given commands and
 * returned.
 *
 * In all cases, the label of the result is the label of the `base` command.
 *
 * @template K the type of model ID used by the Model Manager
 * @param base the command on which to append one or more additional commands
 * @param commands commands to append
 * @returns a compound of the `base` and, `commands`, in that order
 */
export const append = <K = string>(
  base: Command<K>,
  ...commands: Command<K>[]
): Command<K> => {
  if (!commands || commands.length === 0) {
    return base;
  }

  let result: CompoundCommand<K>;

  if (isCompoundCommand(base)) {
    result = base;
    base.append(...commands);
  } else {
    result = new CompoundCommandImpl(base.label, base, ...commands);
  }

  return result;
};

/**
 * Convert a map of (Command, Operation[]) to a map of (Model, Operation[]).

 * @param commands The map to convert (typically the result of an execute/undo/redo call)
 * @returns A map grouping result Operation[] by affected model
 */
export const groupByModelId = <K = string>(
  commands: Map<Command<K>, Operation[]>
): Map<K, Operation[]> => {
  const result = new Map<K, Operation[]>();

  for (const command of commands.keys()) {
    if (!isCompoundCommand(command)) {
      const operations = commands.get(command);
      if (operations !== undefined) {
        const existingOps = result.get(command.modelId);
        if (existingOps === undefined) {
          result.set(command.modelId, operations);
        } else {
          existingOps.push(...operations);
        }
      }
    }
  }
  return result;
};

class SimpleCommandIterator<K = string> implements Iterator<SimpleCommand<K>> {
  private _nextValue?: SimpleCommand<K>;

  constructor(source: SimpleCommand<K>) {
    this._nextValue = source;
  }

  next(): IteratorResult<SimpleCommand<K>> {
    const value = this._nextValue;
    this._nextValue = undefined;

    return value
      ? {
          done: false,
          value,
        }
      : {
          done: true,
          value,
        };
  }
}

class CompoundCommandIterator<K = string>
  implements Iterator<SimpleCommand<K>>
{
  private _iterators: Iterator<SimpleCommand<K>>[];
  private _cursor = 0;

  constructor(source: CompoundCommand<K>) {
    this._iterators = source
      .getCommands()
      .map((command) =>
        isCompoundCommand(command)
          ? new CompoundCommandIterator(command)
          : new SimpleCommandIterator(command)
      );
  }

  next(): IteratorResult<SimpleCommand<K>> {
    if (this._cursor >= this._iterators.length) {
      this._iterators.length = 0;
      this._cursor = 0;
      return {
        done: true,
        value: undefined,
      };
    }

    const nextResult = this._iterators[this._cursor].next();
    if (!nextResult.done) {
      return nextResult;
    }

    // Advance to the next iterator
    this._cursor++;
    return this.next();
  }
}
