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

import { Operation } from 'fast-json-patch';
import {
  Can,
  Command,
  CommandAnalysis,
  CommandResult,
  CompoundCommandImpl,
  CoreCommandStack,
  CoreCommandStackSubscription,
  DirtyStateChangedCallback,
  EditingContext,
  EditingContextChangedCallback,
  MaybePromise,
  RedoAnalysis,
  SimpleCommandResult,
  UndoAnalysis,
  UndoRedoOp,
  isCompoundCommand,
} from '../core';

import { ExclusiveExecutor } from '../util';

/** Any operation that can be performed on a command. */
export type CommandOp = 'execute' | UndoRedoOp;

/** A savepoint record that points to a stack entry. */
interface StackEntrySavepoint<K = string> {
  type: 'savepoint';
  entry: StackEntry<K>;
}

/**
 * A savepoint record that records the last known dirty
 * models at time of flushing the context.
 */
interface FlushedSavepoint<K> {
  type: 'flushed';
  dirtyModelIds: K[];
}

/** A savepoint record. */
type Savepoint<K = string> = StackEntrySavepoint<K> | FlushedSavepoint<K>;

export interface WorkingCopyManager<K = string> {
  /**
   * Prepare a new edit session in which working copies will be required.
   */
  open(modelId: K[]): void;

  /**
   * Whether the working copy manager has an open session.
   */
  isOpen(modelId: K[]): boolean;

  /**
   * Get a working copy of the model identified by the given ID, if it
   * exists. Until changes are committed or the working copies are
   * reset by a call to {@link open}, the same working copy must be
   * supplied for all requests for the same ID.
   */
  getWorkingCopy(modelId: K): object | undefined;

  /**
   * Get the current public state of the model identified by the given ID, if it
   * exists. **Note** that this **is not a working copy**.
   */
  getModel(modelId: K): object | undefined;

  /**
   * Optional method to follow up changes
   * performed on models with further changes to be executed in
   * isolation, not on the command history.
   * The purpose of such changes must only be to ensure integrity of
   * dependencies between properties of the models changed in this
   * `commandResult`.
   * The hook, if defined, is called following every execution, undo,
   * and redo of any command, and so must be prepared to logically
   * invert changes that it had provided previously to whatever extent
   * makes sense for its models. It is for this reason that the changes
   * provided by this hook are not recorded in the history, because
   * the hook is invoked also on undo/redo, not just on the original
   * execution of every command.
   */
  createFollowUpCommand?(
    commandResult: Map<Command<K>, Operation[]>
  ): MaybePromise<Command<K> | undefined>;

  /**
   * Commit the current working copy state back to the model storage,
   * with a summary of the changes that are being committed.
   */
  commit(result: Map<Command<K>, Operation[]>): void;

  /**
   * Discard the current working copy state and close.
   */
  cancel(modelIds: K[]): void;
}

export class CoreCommandStackImpl<K = string> implements CoreCommandStack<K> {
  /** The most recent of all commands executed, in temporal order, in all editing contexts. */
  private _top?: StackEntry<K>;

  /**
   * A pointer for each editing context to the top of its undo stack, keyed by editing context ID.
   * Use key type `string`, not `EditingContext`, to be explicit in case of any future evolution
   * of the editing context as a complex type with a string identifier.
   */
  private _undoEntries = new Map<string, StackEntry<K>>();

  /**
   * A pointer for each editing context to the top of its redo stack, keyed by editing context ID.
   * @see {@link _undoEntries}
   */
  private _redoEntries = new Map<string, StackEntry<K>>();

  /**
   * A pointer to the stack entry that is the last command executed or redone in each context
   * at the time that context was last marked saved.
   * If a context does not have an entry then either it was never saved or it was saved when
   * no commands have been executed/redone, which makes no difference.
   * If the mapping is the flush token, then the context was dirty at the time it was flushed.
   */
  private _savepoints = new Map<string, Savepoint<K>>();

  /**
   * Subscriptions by editing context, with the `null` key track subscriptions to all contexts.
   */
  private _subscriptions = new Map<
    EditingContext | null,
    CoreCommandStackSubscription<K>[]
  >();

  /**
   * Exclusively execute all public operations on the stack.
   */
  private _exclusive = new ExclusiveExecutor<K>();

  /**
   * Operations to run after committing a working copy transaction.
   */
  private postCommitOperations = <(() => unknown)[]>[];

  /**
   * Constructor of the core command stack.
   *
   * @param notify a call-back that receives the notification of changes
   *   applied to one or more models, to broadcast to subscriptions or
   *   to process otherwise
   * @param createFollowUpCommand  Optional hook to follow up changes
   *   performed on models with further changes to be executed in
   *   isolation, not on the command history.
   *   The purpose of such changes must only be to ensure integrity of
   *   dependencies between properties of the models changed in this
   *   `commandResult`.
   *   The hook, if defined, is called following every execution, undo,
   *   and redo of any command, and so must be prepared to logically
   *   invert changes that it had provided previously to whatever extent
   *   makes sense for its models. It is for this reason that the changes
   *   provided by this hook are not recorded in the history, because
   *   the hook is invoked also on undo/redo, not just on the original
   *   execution of every command.
   */
  constructor(private workingCopyManager: WorkingCopyManager<K>) {}

  execute(
    command: Command<K>,
    ...contexts: EditingContext[]
  ): Promise<Map<Command<K>, Operation[]> | undefined> {
    return this._exclusive.run(
      async () => {
        return this.withWorkingCopies(
          this.workingCopyManager,
          async () => {
            await this.checkExecute(command, ...contexts);

            return this.withDirtyNotification(contexts, async () => {
              const commandResult = await mapCommandResult(
                command,
                this.perform('execute', command)
              );

              this.executed(new StackEntry(command, contexts));

              this.afterCommit(() =>
                contexts.forEach((context) =>
                  this.notifyCommandStackChanged(context, 'executed', command)
                )
              );

              return this.postChange(commandResult);
            });
          },
          getModelIds(command)
        );
      },
      contexts,
      getModelIds(command)
    );
  }

  /**
   * Perform an `operation` on a `command`.
   *
   * @param operation whether to execute, undo, or redo the `command`
   * @param command the command to execute, undo, or redo
   * @return a description of the model changes resulting from the execution, undo, or redo of the `command`
   */
  private perform(
    operation: CommandOp,
    command: Command<K>
  ): SimpleCommandResult | CommandResult<K> {
    if (isCompoundCommand(command)) {
      return command[operation](
        this.workingCopyManager.getWorkingCopy.bind(this.workingCopyManager)
      );
    }
    const workingCopy = this.workingCopyManager.getWorkingCopy(command.modelId);
    if (!workingCopy) {
      throw new Error(`Model ${command.modelId} does not exist.`);
    }
    return command[operation](workingCopy);
  }

  executeAndAppend(
    appendedContext: EditingContext,
    command: Command<K>,
    ...contexts: EditingContext[]
  ): Promise<Map<Command<K>, Operation[]> | undefined> {
    const modelIds = getModelIds(command);

    return this._exclusive.run(
      async () => {
        const appendedEntry = this.getEntry(appendedContext, 'undo');
        if (!appendedEntry) {
          throw new Error('no command to append in the editing context');
        }

        return this.withWorkingCopies(
          this.workingCopyManager,
          async () => {
            await this.checkExecute(command, appendedContext, ...contexts);

            const allContexts = contexts.includes(appendedContext)
              ? contexts
              : [appendedContext, ...contexts];

            return this.withDirtyNotification(allContexts, async () => {
              const commandResult = await mapCommandResult(
                command,
                this.perform('execute', command)
              );

              this.appended(appendedEntry, new StackEntry(command, contexts));

              this.afterCommit(() =>
                allContexts.forEach((context) =>
                  this.notifyCommandStackChanged(context, 'executed', command)
                )
              );

              return this.postChange(commandResult);
            });
          },
          modelIds
        );
      },
      contexts,
      modelIds
    );
  }

  undo(
    context: EditingContext,
    withDependencies = true
  ): Promise<Map<Command<K>, Operation[]> | undefined> {
    return this.performUndoRedo(context, 'undo', withDependencies);
  }

  /**
   * Revert the command on the top of the undo or redo stack of an editing `context`
   * according to the indicated `op`eration.
   *
   * @param context the editing context to undo or redo
   * @param op whether to revert the top of the undo or the redo stack of the `context`
   * @param withDependencies whether first to revert dependencies of the `context` as necessary
   *
   * @see {@link undo}
   * @see {@link redo}
   */
  private async performUndoRedo(
    context: EditingContext,
    op: UndoRedoOp,
    withDependencies: boolean
  ): Promise<Map<Command<K>, Operation[]> | undefined> {
    const maybeEntry = this.getEntry(context, op);
    if (!maybeEntry) {
      throw new Error(`nothing to ${op}`);
    }
    let entry = maybeEntry;

    if (withDependencies) {
      const dependencies = this.getDependencyEntries(entry, op);

      // Append all dependencies to the command being undone/redone for eventual atomic redo/undo
      entry = dependencies.reduce(
        (prev, curr) => this.merge(prev, curr, op),
        entry
      );

      // And eliminate those dependencies as separate entries
      dependencies.forEach((dep) => this.pop(dep));
    }
    const command = entry.command;
    const affectedContexts = Array.from(entry.editingContexts);
    const modelIds = getModelIds(entry.command);

    return this._exclusive.run(
      async () => {
        await this.checkUndoRedo(entry, op, withDependencies);

        return this.withWorkingCopies(
          this.workingCopyManager,
          async () => {
            return this.withDirtyNotification(affectedContexts, async () => {
              const commandResult = await mapCommandResult(
                command,
                this.perform(op, command)
              );

              const eventType = op === 'redo' ? 'redone' : 'undone';
              this[eventType](entry);

              this.afterCommit(() =>
                affectedContexts.forEach((ctx) =>
                  this.notifyCommandStackChanged(ctx, eventType, command)
                )
              );

              return this.postChange(commandResult);
            });
          },
          modelIds
        );
      },
      affectedContexts,
      modelIds
    );
  }

  /**
   * Merge two stack entries and remove the one that was merged into the other from
   * the history as now it is included in the other.
   *
   * @param into the stack entry into which to merge the other
   * @param from the other entry to merge `into` the first
   * @param forOp whether the merge is for undo or redo, which determines the order
   *   in which the commands of the `from` entry are merged `into` the other's commands
   * @returns the result of the merge, which is just the `into` entry that now has been increased
   *
   * @see {@link StackEntry.merge}
   */
  private merge(
    into: StackEntry<K>,
    from: StackEntry<K>,
    forOp: UndoRedoOp
  ): StackEntry<K> {
    const result = into.merge(from, forOp);
    const prev = from.pop();
    if (this._top === from) {
      this._top = prev;
    }
    return result;
  }

  redo(
    context: EditingContext,
    withDependencies = true
  ): Promise<Map<Command<K>, Operation[]> | undefined> {
    return this.performUndoRedo(context, 'redo', withDependencies);
  }

  /**
   * Perform an `operation` on command(s) in my history that themselves modify working
   * copies of models supplied by the given working copy manager.
   * On successful conclusion of the `operation` the working copies that it used are committed
   * to the model manager; on failure they are just abandoned to retain the prior state of
   * all managed models.
   * In the event that the working copies are committed, all post-commit operations gathered
   * during the `operation` are executed; otherwise they too are abandoned.
   *
   * @param workingCopyManager the model manager's working-copy manager
   * @param operation the model operation to perform on working copies
   */
  protected async withWorkingCopies<K>(
    workingCopyManager: WorkingCopyManager<K>,
    operation: () => Promise<Map<Command<K>, Operation[]> | undefined>,
    modelIds: K[]
  ): Promise<Map<Command<K>, Operation[]> | undefined> {
    let result: Map<Command<K>, Operation[]> | undefined;
    workingCopyManager.open(modelIds);
    try {
      result = await operation();
    } finally {
      try {
        if (result) {
          workingCopyManager.commit(result);
          this.postCommitOperations.forEach((op) => op());
        } else {
          workingCopyManager.cancel(modelIds);
        }
      } finally {
        this.postCommitOperations.length = 0;
      }
    }
    return result;
  }

  /**
   * Gather an operation to run when model working copies are committed
   * to the model manager.
   *
   * @param closer an operation to run on working copy commit
   */
  protected afterCommit(closer: () => unknown): void {
    this.postCommitOperations.push(closer);
  }

  /**
   * Perform an `operation` on command(s) in my history with tracking and subsequent notification
   * of changes in the dirty state of models. Upon successful completion of the `operation` and
   * committing of its working copies to the model manager, dirty state change subscriptions
   * will be notified.
   *
   * @param contexts the editing contexts in which the `operation` is performed
   * @param operation the model operation to perform that will potentially change dirty states
   */
  protected async withDirtyNotification<T>(
    contexts: EditingContext[],
    operation: () => Promise<T>
  ): Promise<T> {
    const wasDirty = contexts.map((context) => this.isDirty(context));
    const oldDirtyModels = contexts.map(
      (context, index) =>
        new Set(wasDirty[index] ? this.getDirtyModelIds(context) : [])
    );

    const result = await operation();

    this.afterCommit(() => {
      const isDirty = contexts.map((context) => this.isDirty(context));
      const newDirtyModels = contexts.map(
        (context, index) =>
          new Set(isDirty[index] ? this.getDirtyModelIds(context) : [])
      );

      // Compute the symmetric difference
      oldDirtyModels.forEach((models, index) =>
        Array.from(models).forEach((model) => {
          if (newDirtyModels[index].delete(model)) {
            models.delete(model);
          }
        })
      );

      for (let i = 0; i < contexts.length; i++) {
        if (newDirtyModels[i].size > 0 || oldDirtyModels[i].size > 0) {
          const modelDirtyState = new Map<K, boolean>();
          newDirtyModels[i].forEach((modelId) =>
            modelDirtyState.set(modelId, true)
          );
          oldDirtyModels[i].forEach((modelId) =>
            modelDirtyState.set(modelId, false)
          );
          this.notifyDirtyStateChanged(contexts[i], modelDirtyState);
        }
      }
    });

    return result;
  }

  /**
   * Perform all post-change processing steps, including at least
   *
   * 1. Run the follow-up hook, if defined
   * 2. Run the notify hook
   *
   * if and only if the `commandResult` is defined.
   *
   * @param commandResult the result of a command execution, undo, or redo
   * @param the processed command result
   */
  private async postChange(
    commandResult: Map<Command<K>, Operation[]> | undefined
  ): Promise<Map<Command<K>, Operation[]> | undefined> {
    if (!commandResult) {
      return commandResult;
    }

    const followUpResult = await this.processFollowUp(commandResult);
    let combinedResult = commandResult;
    if (followUpResult) {
      // Copy the original result and combine with the follow-up to
      // not modify the original `commandResult` map
      combinedResult = new Map<Command<K>, Operation[]>(combinedResult);
      followUpResult.forEach((value, key) => combinedResult.set(key, value));
    }
    return combinedResult;
  }

  /**
   * Call my follow-up hook, if defined, and return the results of executing the
   * command that it provides.
   *
   * @param commandResult the command result to inject into the follow-up hook
   * @returns the results from the follow-up hook's provided command, if any
   */
  private async processFollowUp(
    commandResult: Map<Command<K>, Operation[]>
  ): Promise<Map<Command<K>, Operation[]> | undefined> {
    const followUp = await this.workingCopyManager.createFollowUpCommand?.(
      commandResult
    );
    if (followUp) {
      const canFollowUp = await this.test('canExecute', followUp);
      if (!canFollowUp) {
        console.error(
          'Follow-up command is not executable. Model integrity may be compromised.'
        );
      } else {
        return mapCommandResult(
          followUp,
          await this.perform('execute', followUp)
        );
      }
    }

    return undefined;
  }

  canExecute(command: Command<K>, ...contexts: string[]): Promise<boolean> {
    const validContexts = validateContexts(contexts);
    if (validContexts !== true) {
      return Promise.resolve(false);
    }
    return this.test('canExecute', command);
  }

  canUndo(context: EditingContext, withDependencies = true): Promise<boolean> {
    const entry = this.getEntry(context, 'undo');
    return !entry
      ? Promise.resolve(false)
      : this.canUndoRedo(entry, 'undo', withDependencies);
  }

  canRedo(context: EditingContext, withDependencies = true): Promise<boolean> {
    const entry = this.getEntry(context, 'redo');
    return !entry
      ? Promise.resolve(false)
      : this.canUndoRedo(entry, 'redo', withDependencies);
  }

  getUndoCommand(context: EditingContext): Command<K> | undefined {
    return this.getEntry(context, 'undo')?.command;
  }

  getRedoCommand(context: EditingContext): Command<K> | undefined {
    return this.getEntry(context, 'redo')?.command;
  }

  flush(context: EditingContext): Command<K>[] {
    const dirtyModelIds = this.getDirtyModelIds(context);
    if (dirtyModelIds.length) {
      // We're flushing this context and so have to assume that
      // the model is changed in some unsupported fashion and
      // must be assumed to be dirty
      this._savepoints.set(context, {
        type: 'flushed',
        dirtyModelIds,
      });
    } else {
      this._savepoints.delete(context);
    }

    this._undoEntries.delete(context);
    this._redoEntries.delete(context);

    const result: Command<K>[] = [];
    let previous: StackEntry<K> | undefined;

    for (let entry = this._top; entry; entry = previous) {
      previous = entry.previous;
      entry.removeContext(context);
      if (entry.isPurgeable) {
        result.push(entry.command);
        this.pop(entry);
      }
    }

    this.notifyCommandStackChanged(context, 'flushed');

    // Flush does not imply changes to dirty state

    return result;
  }

  /**
   * Add the stack entry for a command that has been executed in one or more contexts.
   *
   * @param entry the stack entry to add
   */
  private executed(entry: StackEntry<K>): void {
    this.flushRedo(entry);
    entry.editingContexts.forEach((ctx) => {
      this._undoEntries.set(ctx, entry);
    });

    this.push(entry);
  }

  /**
   * Merge a command that has been executed into the stack-entry for the command that it appended.
   *
   * @param appendedEntry the entry for the command that was appended to
   * @param newEntry an entry for the command that was appended
   */
  private appended(
    appendedEntry: StackEntry<K>,
    newEntry: StackEntry<K>
  ): void {
    appendedEntry.merge(newEntry);
    this.flushRedo(appendedEntry);
    appendedEntry.editingContexts.forEach((ctx) => {
      this._undoEntries.set(ctx, appendedEntry); // Accounting for new contexts
    });
  }

  /**
   * Flush all redo stacks for the editing contexts of an `entry`.
   * This is used after executing a command whose `entry` this is.
   *
   * @param entry an entry that has just been executed
   */
  private flushRedo(entry: StackEntry<K>): void {
    for (const ctx of entry.editingContexts) {
      const redoRoot = this.getEntry(ctx, 'redo');
      if (redoRoot) {
        // Flush all of its contexts from this point
        this.flushRedoFrom(redoRoot);

        this.pop(redoRoot);
      }
    }
  }

  /**
   * Flush the redo stack starting from a given entry all the way down to the bottom.
   * All editing contexts of the starting entry are flushed from that point.
   * Thus some contexts may still have some older redo entries remaining.
   *
   * @param startingAt the top of the redo stack to flush
   */
  private flushRedoFrom(startingAt: StackEntry<K>): void {
    for (const ctx of startingAt.editingContexts) {
      // Are we flushing the entire redo history of this context?
      if (this.getEntry(ctx, 'redo') === startingAt) {
        this._redoEntries.delete(ctx);
      }

      const next = startingAt.nextIn(ctx);
      if (next) {
        // Flush recursively from this one
        this.flushRedoFrom(next);
      }
    }

    // This entry is now removed from the redo history of all its
    // contexts
    this.pop(startingAt);
  }

  /**
   * Push a new entry onto the stack for a command that was executed.
   *
   * @param entry an entry to push onto the stack
   * @returns the `entry` that was pushed
   */
  private push(entry: StackEntry<K>): StackEntry<K> {
    if (this._top) {
      this._top = this._top.push(entry);
    } else {
      this._top = entry;
    }

    return entry;
  }

  /**
   * Remove an entry from wherever in the stack it occurs. So, no strictly speaking
   * a "pop" which is a LIFO operation, but it's the converse of our {@link push}.
   *
   * @param entry an entry to remove from the stack
   * @returns the stack entry that remains at the point where the `entry` was removed,
   *  if the `entry` was not the very first in the temporal order
   */
  private pop(entry: StackEntry<K>): StackEntry<K> | undefined {
    const result = entry.pop();

    if (entry === this._top) {
      this._top = result;
    }
    return result;
  }

  /**
   * Update the undo pointers for all editing contexts of an `entry` whose
   * command has been undone.
   *
   * @param entry the entry for a command that was undone
   */
  private undone(entry: StackEntry<K>): void {
    entry.editingContexts.forEach((ctx) => {
      this._redoEntries.set(ctx, entry);

      const previous = entry.previousIn(ctx);
      if (previous) {
        this._undoEntries.set(ctx, previous);
      } else {
        this._undoEntries.delete(ctx);
      }
    });
  }

  /**
   * Update the redo pointers for all editing contexts of an `entry` whose
   * command has been redone.
   *
   * @param entry the entry for a command that was redone
   */
  private redone(entry: StackEntry<K>): void {
    entry.editingContexts.forEach((ctx) => {
      this._undoEntries.set(ctx, entry);

      const next = entry.nextIn(ctx);
      if (next) {
        this._redoEntries.set(ctx, next);
      } else {
        this._redoEntries.delete(ctx);
      }
    });
  }

  /**
   * Get the entry for the command that is at the top of an editing context's
   * undo stack or redo stack, that being the next command to undo or redo in
   * the context.
   *
   * @param editingContext the editing context
   * @param op whether to retrieve the undo or the redo entry
   * @returns the entry for the command at the top of the context's undo or redo stack
   */
  private getEntry(
    editingContext: EditingContext,
    op: UndoRedoOp
  ): StackEntry<K> | undefined {
    return (op === 'redo' ? this._redoEntries : this._undoEntries).get(
      editingContext
    );
  }

  /**
   * Assert that a command is executable.
   * Precondition for executing it on the stack.
   *
   * @param command a command to be executed
   * @param contexts the editing contexts in which it is to be executed
   * @throws if the `command` cannot be executed
   */
  private async checkExecute(
    command: Command<K>,
    ...contexts: EditingContext[]
  ): Promise<void> {
    checkContexts(contexts);
    if (!(await this.test('canExecute', command))) {
      throw new Error('command is not executable');
    }
  }

  /**
   * Test whether an operation on some `command` would be permitted in its current state.
   *
   * @param condition whether the `canExecute`, `canUndo`, or `canRedo` condition of the command is to be tested
   * @param command the command to be tested
   * @return the result of the test of the `command`'s current state under the `condition`
   */
  private async test(
    condition: Can<CommandOp>,
    command: Command<K>
  ): Promise<boolean> {
    if (isCompoundCommand(command)) {
      return command[condition](
        bindGetModel(this.workingCopyManager, getModelIds(command))
      );
    }
    const model = getModel(this.workingCopyManager, command.modelId);
    return !!model && (await command[condition](model));
  }

  /**
   * Assert that a command is revertible for undo or redo.
   * Precondition for undoing or redoing it on the stack.
   *
   * @param entry the entry for a command to be reverted
   * @param op the undo/redo operation to be validated
   * @param withDependencies whether to allow dependencies in the undo
   * @throws if the command of the `entry` cannot be reverted
   * @see {@link canUndoRedo}
   */
  private async checkUndoRedo(
    entry: StackEntry<K>,
    op: UndoRedoOp,
    withDependencies: boolean
  ): Promise<void> {
    if (!entry || !(await this.canUndoRedo(entry, op, withDependencies))) {
      throw new Error(`command is not ${op}able`);
    }
  }

  /**
   * Query whether a command is revertible for undo or redo.
   *
   * A command may intrinsically be non-revertible or it may not be revertible because
   * one of its contexts has a command that would need to be reverted before it.
   *
   * @param entry the entry for a command to be revered
   * @param op whether the reversion is an undo or a redo
   * @param withDependencies whether to allow dependencies in the undo. Default `false`
   * @returns whether the command of the `entry` can be reverted
   */
  private async canUndoRedo(
    entry: StackEntry<K>,
    op: UndoRedoOp,
    withDependencies: boolean
  ): Promise<boolean> {
    const toUndoRedo = new Set(this.getDependencyEntries(entry, op));
    toUndoRedo.add(entry);

    if (toUndoRedo.size > 1 && !withDependencies) {
      return Promise.resolve(false);
    }

    const canOp = can(op);
    const results = Promise.all(
      Array.from(toUndoRedo).map((each) => this.test(canOp, each.command))
    );
    return results.then((all) => all.every((each) => each));
  }

  analyzeUndo(context: string): Promise<UndoAnalysis> {
    return this.analyzeUndoRedo(context, 'undo');
  }

  /**
   * Compute the detailed analysis of the undoability or redoability of an editing `context`.
   *
   * @param context the editing context to analyze
   * @param op whether to analyze the feasibility of `undo` or `redo` of the `context`
   * @return the detailed analysis report
   */
  private async analyzeUndoRedo<Op extends UndoRedoOp>(
    context: string,
    op: Op
  ): Promise<CommandAnalysis<Op>> {
    const canOp = can(op);

    // Initially assume the most trivial success
    const result = {
      [canOp]: true,
      hasDependencies: false,
      summary: `The ${op} command of context '${context}' is ${op}able.`,
      contexts: {},
    } as CommandAnalysis<Op>;
    // Cast out just the dynamic [canOp] record for type-safe assignment
    const success: Record<Can<Op>, boolean> = result;

    const undoRedoEntry = this.getEntry(context, op);
    if (!undoRedoEntry) {
      success[canOp] = false;
      result.summary = `There is no command to ${op} in context '${context}'.`;
      result.contexts[context] = false;
      return result;
    }

    const allEntries = new Set(this.getDependencyEntries(undoRedoEntry, op));
    allEntries.add(undoRedoEntry);
    result.hasDependencies = allEntries.size > 1;

    for (const entry of allEntries) {
      const canUndoRedo = await this.test(canOp, entry.command);
      success[canOp] &&= canUndoRedo;
      if (entry === undoRedoEntry) {
        // This entry is the one for the original context. We skip checking all additional associated editing contexts for it as
        // they are not necessarily dependencies.
        result.contexts[context] = canUndoRedo;
      } else {
        for (const ctx of entry.editingContexts) {
          result.contexts[ctx] = (result.contexts[ctx] ?? true) && canUndoRedo;
        }
      }
    }

    if (result[canOp]) {
      // Nothing further to compute.
      return result;
    }

    if (!result.hasDependencies) {
      result.summary = `The ${op} command of context '${context}' is not ${op}able.`;
      return result;
    }

    // Assemble a more elaborate summary.
    const failedDependencies = Object.keys(result.contexts)
      .filter((ctx) => ctx !== context && !result.contexts[ctx])
      .map((ctx) => `'${ctx}'`);
    result.summary = `The ${op} command of context '${context}' is not ${op}able because`;
    if (!result.contexts[context]) {
      result.summary = `${result.summary} it is not itself ${op}able`;
      if (failedDependencies.length === 0) {
        result.summary = result.summary + '.';
      } else {
        result.summary = result.summary + ' and';
      }
    }
    if (failedDependencies.length === 1) {
      result.summary = `${result.summary} its dependency ${failedDependencies[0]} is not ${op}able.`;
    } else if (failedDependencies.length > 1) {
      result.summary = `${
        result.summary
      } its dependencies ${failedDependencies.join(', ')} are not ${op}able.`;
    }

    return result;
  }

  /**
   * Get the stack entries encoding dependencies, if any, of the given editing `context`
   * for undo or redo.
   *
   * @param context an editing context for which to get dependencies
   * @param op whether the analysis is for `undo` or for `redo`
   * @return the stack entries, or an empty array if none, that must be undone or
   *   redone in other contexts before the given `context` can be undone or redone
   */
  private getDependencyEntries(
    entry: StackEntry<K>,
    op: UndoRedoOp
  ): StackEntry<K>[] {
    const result: StackEntry<K>[] = [];

    const chase = op === 'redo' ? 'nextIn' : 'previousIn';
    for (const ctx of entry.editingContexts) {
      let other = this.getEntry(ctx, op);
      while (other && other !== entry) {
        result.push(other);
        other = other[chase](ctx);
      }
    }

    return result;
  }

  analyzeRedo(context: string): Promise<RedoAnalysis> {
    return this.analyzeUndoRedo(context, 'redo');
  }

  markSaved(editingContext: EditingContext): void {
    const wasDirty = this.isDirty(editingContext);
    const oldDirtyModels = wasDirty
      ? this.getDirtyModelIds(editingContext)
      : [];

    const entry = this.getEntry(editingContext, 'undo');
    if (entry) {
      this._savepoints.set(editingContext, { type: 'savepoint', entry });
    } else {
      this._savepoints.delete(editingContext);
    }

    if (wasDirty) {
      // Save can only make models clean that were dirty before
      const dirtyState = new Map<K, boolean>();
      oldDirtyModels.forEach((modelId) => dirtyState.set(modelId, false));
      this.notifyDirtyStateChanged(editingContext, dirtyState);
    }
  }

  isDirty(editingContext: string): boolean {
    const savepoint = this._savepoints.get(editingContext);

    if (savepoint?.type === 'flushed') {
      // Easy case
      return true;
    }
    const savepointEntry = savepoint?.entry;

    // We are dirty if only one of undo entry and savepoint exists or
    // if both exist but are different
    const undo = this.getEntry(editingContext, 'undo');
    return undo !== savepointEntry;
  }

  getDirtyModelIds(editingContext: EditingContext): K[] {
    let result: Set<K>;
    const savepoint = this._savepoints.get(editingContext);
    let savepointEntry: StackEntry<K> | undefined;

    if (savepoint?.type === 'flushed') {
      // Include these at least
      result = new Set(savepoint.dirtyModelIds);
    } else {
      result = new Set<K>();
      savepointEntry = savepoint?.entry;
    }

    const collectModelIds = (entry: StackEntry<K>) => {
      if (isCompoundCommand(entry.command)) {
        entry.command.forEach((command) => result.add(command.modelId));
      } else {
        result.add(entry.command.modelId);
      }
    };

    const undoEntry = this.getEntry(editingContext, 'undo');
    const redoEntry = this.getEntry(editingContext, 'redo');

    if (undoEntry && (!savepointEntry || undoEntry.succeeds(savepointEntry))) {
      // Trace from the undo stack top down to but not including the savepoint to trace commands that
      // were executed or redone since last save
      for (
        let entry: StackEntry<K> | undefined = undoEntry;
        entry && entry !== savepointEntry;
        entry = entry.previousIn(editingContext)
      ) {
        collectModelIds(entry);
      }
    }

    // Redo stack is only interesting if a savepoint exists and is within it
    if (
      redoEntry &&
      savepointEntry &&
      (redoEntry === savepointEntry || redoEntry.precedes(savepointEntry))
    ) {
      // Trace from the redo stack top down to AND including the savepoint to trace commands that
      // were undone since last save. Recall that the redo stack is upside-down within the overall history.
      for (
        let entry: StackEntry<K> | undefined = redoEntry;
        entry;
        entry = entry.nextIn(editingContext)
      ) {
        collectModelIds(entry);
        if (entry === savepointEntry) {
          break;
        }
      }
    }

    return Array.from(result);
  }

  getEditingContexts(): EditingContext[] {
    // This accounts for flushed but dirty contexts
    const result = new Set<EditingContext>(this._savepoints.keys());

    // And this accounts for all other contexts, regardless of dirty state
    for (let entry = this._top; entry; entry = entry.previous) {
      entry.editingContexts.forEach((editingContext) =>
        result.add(editingContext)
      );
    }

    return Array.from(result);
  }

  subscribe(
    editingContext?: string | undefined
  ): CoreCommandStackSubscription<K> {
    const key = editingContext ?? null;
    const result: CoreCommandStackSubscription<K> = {
      close: () => {
        const subs = this._subscriptions.get(key);
        if (subs) {
          const index = subs.indexOf(result);
          subs.splice(index, 1);
          if (subs.length === 0) {
            this._subscriptions.delete(key);
          }
        }
      },
    };

    let subs = this._subscriptions.get(key);
    if (!subs) {
      subs = [];
      this._subscriptions.set(key, subs);
    }
    subs.push(result);

    return result;
  }

  /**
   * Invoke the `onContextChanged` call-backs of subscriptions that have it.
   *
   * @param args the call-back arguments to pass along
   */
  protected notifyCommandStackChanged(
    ...args: Parameters<EditingContextChangedCallback<K>>
  ): void {
    const editingContext = args[0];

    for (const sub of this.getSubscriptions(editingContext)) {
      if (sub.onContextChanged) {
        safeCallback(sub.onContextChanged, ...args);
      }
    }
  }

  /**
   * Get all subscriptions pertaining to the given editing context.
   *
   * @param editingContext an editing context
   * @returns the subscriptions targeting the context specifically and all contexts generally
   */
  private getSubscriptions(
    editingContext: EditingContext
  ): CoreCommandStackSubscription<K>[] {
    // Make a copy in case a call-back adds or removes subscriptions
    return [
      ...(this._subscriptions.get(editingContext) ?? []),
      ...(this._subscriptions.get(null) ?? []),
    ];
  }

  /**
   * Invoke the `onDirtyStateChanged` call-backs of subscriptions that have it.
   *
   * @param args the call-back arguments to pass along
   */
  protected notifyDirtyStateChanged(
    ...args: Parameters<DirtyStateChangedCallback<K>>
  ): void {
    const editingContext = args[0];

    for (const sub of this.getSubscriptions(editingContext)) {
      if (sub.onDirtyStateChanged) {
        safeCallback(sub.onDirtyStateChanged, ...args);
      }
    }
  }
}

/**
 * Assert that a list of contexts for execution of a command is valid.
 * Precondition for executing a command on the stack.
 *
 * @param contexts contexts to be associated with a command's execution
 * @throws if the `contexts` array is `undefined` or empty
 */
const checkContexts = (contexts?: EditingContext[]): void => {
  const valid = validateContexts(contexts);
  if (valid !== true) {
    throw new Error(valid);
  }
};

/**
 * Check whether a list of contexts for execution of a command is valid.
 *
 * @param contexts contexts to be associated with a command's execution
 * @returns an explanation if the `contexts` array is `undefined` or empty; `true`, otherwise
 */
const validateContexts = (contexts?: EditingContext[]): string | true => {
  if (!contexts || !contexts.length) {
    return 'an editing context is required';
  }
  return true;
};

/**
 * Coerce the result of execution, undo, or redo of a command to a mapping of leaf
 * (simple) commands to their results.
 *
 * @param command a command that has been executed, undone, or redone
 * @param commandResult its own result of execute, undo, or redo
 * @returns the `commandResult` if it is already a map from a compound command
 *   result or else a new map of the `command` to the result
 */
const mapCommandResult = async <K = string>(
  command: Command<K>,
  commandResult: MaybePromise<
    Operation[] | Map<Command<K>, Operation[]> | undefined
  >
): Promise<Map<Command<K>, Operation[]> | undefined> => {
  const awaitedResult = await commandResult;
  if (!awaitedResult || awaitedResult instanceof Map) {
    return awaitedResult;
  }

  return new Map([[command, awaitedResult]]);
};

/**
 * The command stack is a doubly-linked list, in temporal order of their original execution, of
 * commands and their associated editing contexts.
 * This class implements a node in that list.
 */
export class StackEntry<K = string> {
  /** The editing contexts in which a command was executed. */
  private readonly _editingContexts: Set<EditingContext>;

  /** The command that was executed. */
  private _command: Command<K>;

  /** The next command in the list (stack). */
  private _next?: StackEntry<K>;

  /** The previous command in the list (stack). */
  private _previous?: StackEntry<K>;

  constructor(command: Command<K>, editingContexts: EditingContext[]) {
    this._command = command;
    this._editingContexts = new Set(editingContexts);
  }

  /** Get the command that was executed. */
  get command(): Command<K> {
    return this._command;
  }

  /** Get the editing contexts in which the command was executed. */
  get editingContexts(): Set<EditingContext> {
    return this._editingContexts;
  }

  /**
   * Query whether the entry may be purged because all of its
   * editing contexts have been flushed.
   */
  get isPurgeable(): boolean {
    return !this._editingContexts.size;
  }

  /**
   * Obtain the next command in the stack in temporal order,
   * regardless of editing contexts.
   */
  get next(): StackEntry<K> | undefined {
    return this._next;
  }

  /**
   * Obtain the next command in the stack that has the given
   * editing context.
   *
   * @param editingContext an editing context
   * @returns the next command, if any, in that context
   */
  nextIn(editingContext: EditingContext): StackEntry<K> | undefined {
    for (let next = this.next; next; next = next.next) {
      if (next.hasContext(editingContext)) {
        return next;
      }
    }
    return undefined;
  }

  /**
   * Does this entry precede an`other` in the history?
   * An entry does not precede itself.
   *
   * @param other another stack entry
   * @returns whether the `other` is in my {@link next next chain}
   *
   * @see {@link next}
   */
  precedes(other: StackEntry<K>): boolean {
    for (let next = this.next; next; next = next.next) {
      if (next === other) {
        return true;
      }
    }
    return false;
  }

  /**
   * Obtain the previous command in the stack in temporal order,
   * regardless of editing contexts.
   */
  get previous(): StackEntry<K> | undefined {
    return this._previous;
  }

  /**
   * Obtain the previous command in the stack that has the given
   * editing context.
   *
   * @param editingContext an editing context
   * @returns the previous command, if any, in that context
   */
  previousIn(editingContext: EditingContext): StackEntry<K> | undefined {
    for (let previous = this.previous; previous; previous = previous.previous) {
      if (previous.hasContext(editingContext)) {
        return previous;
      }
    }
    return undefined;
  }

  /**
   * Does this entry succeed an`other` in the history?
   * An entry does not succeed itself.
   *
   * @param other another stack entry
   * @returns whether the `other` is in my {@link previous previous chain}
   *
   * @see {@link previous}
   */
  succeeds(other: StackEntry<K>): boolean {
    for (let previous = this.previous; previous; previous = previous.previous) {
      if (previous === other) {
        return true;
      }
    }
    return false;
  }

  /**
   * Remove editing contexts (that were flushed) from a command.
   *
   * @param editingContexts the editing contexts to remove from the command
   */
  removeContext(...editingContexts: EditingContext[]): void {
    editingContexts.forEach((ctx) => this._editingContexts.delete(ctx));
  }

  /**
   * Query whether my command is associated with the given editing context.
   *
   * @param editingContext an editing context
   * @returns whether the command has that context
   */
  hasContext(editingContext: EditingContext): boolean {
    return this._editingContexts.has(editingContext);
  }

  /**
   * Insert a new entry into the stack following me, making it my new next.
   * My former next becomes its next and I become its previous.
   *
   * @param next my new next entry
   * @returns the `next` entry that was pushed
   * @throws on attempt to push the entry, itself, to make a cycle
   */
  push(next: StackEntry<K>): StackEntry<K> {
    for (
      let check: StackEntry<K> | undefined = next;
      check;
      check = check.next
    ) {
      if (check === this) {
        throw new Error('push would create a cycle');
      }
    }
    const oldNext = this._next;
    if (oldNext) {
      // There is no legitimate way to get here. Executing a command
      // is always the last (in temporal order) command operation and
      // so always pushes onto the top of the CoreCommandStack
      oldNext._previous = next;
    }
    next._next = oldNext;

    this._next = next;
    next._previous = this;

    return next;
  }

  /**
   * Remove me from the stack.
   *
   * @returns my former previous entry
   */
  pop(): StackEntry<K> | undefined {
    const oldPrevious = this._previous;
    const oldNext = this._next;

    if (oldPrevious) {
      oldPrevious._next = oldNext;
    }
    if (oldNext) {
      oldNext._previous = oldPrevious;
    }

    this._next = undefined;
    this._previous = undefined;

    return oldPrevious;
  }

  /**
   * Merge an `entry` into me, appending its command to mine
   * and its editing contexts to mine.
   *
   * @param entry an entry to merge into me
   * @param forOp the operation for which the compound is being prepared
   * @returns me
   */
  merge(entry: StackEntry<K>, forOp: UndoRedoOp = 'undo'): this {
    this._command =
      // Reverse order for the redo op
      forOp === 'redo'
        ? appendForOp(forOp, entry.command, this._command)
        : appendForOp(forOp, this._command, entry.command);
    entry.editingContexts.forEach((ctx) => this._editingContexts.add(ctx));

    return this;
  }
}

/**
 * A specialized compound command that allows appending an already-executed command
 * if the compound has already been executed but not undone.
 */
export class AppendableCompoundCommand<
  K = string
> extends CompoundCommandImpl<K> {
  /** Construct an appendable compound that is initially in the _executed_ state. */
  constructor(label: string, ...commands: Command<K>[]);
  /** Construct an appendable compound that is initially in the _executed_ state. */
  constructor(
    label: string,
    initialState: CompoundCommandImpl['state'],
    ...commands: Command<K>[]
  );
  constructor(
    label: string,
    initialStateOrCommand: CompoundCommandImpl['state'] | Command<K>,
    ...commands: Command<K>[]
  ) {
    super(
      label,
      ...(typeof initialStateOrCommand === 'string'
        ? commands
        : [initialStateOrCommand, ...commands])
    );

    this.state =
      typeof initialStateOrCommand === 'string'
        ? initialStateOrCommand
        : 'executed';
  }

  append(...commands: Command<K>[]): this {
    if (this.wasUndone()) {
      throw new Error('cannot append to a command on the redo stack');
    }

    this._commands.push(...commands);
    return this;
  }
}

/**
 * Compose a `base` command with additional `commands` for either undo.
 * **Note** that compounding commands for their initial execution does not need
 * this specialized mechanism.
 *
 * @param base a command to append to
 * @param commands commands to append to it
 * @returns some command that includes the `base` and all of the additional `commands`
 */
export const append = <K = string>(
  base: Command<K>,
  ...commands: Command<K>[]
): Command<K> => appendForOp('undo', base, ...commands);

/**
 * Compose a `base` command with additional `commands` for either undo or redo.
 * **Note** that compounding commands for their initial execution does not need
 * this specialized mechanism.
 *
 * @param op the operation for which the compound is being prepared
 * @param base a command to append to
 * @param commands commands to append to it
 * @returns some command that includes the `base` and all of the additional `commands`
 */
const appendForOp = <K = string>(
  op: UndoRedoOp,
  base: Command<K>,
  ...commands: Command<K>[]
): Command<K> => {
  if (!commands || !commands.length) {
    return base;
  }

  let result: AppendableCompoundCommand<K>;

  if (base instanceof AppendableCompoundCommand) {
    result = base;
    base.append(...commands);
  } else {
    const initialState = op === 'redo' ? 'undone' : 'executed';
    result = new AppendableCompoundCommand(
      base.label,
      initialState,
      base,
      ...commands
    );
  }

  return result;
};

const getModel = <K>(
  workingCopyManager: WorkingCopyManager<K>,
  modelId: K
): object | undefined => {
  if (workingCopyManager.isOpen([modelId])) {
    return workingCopyManager.getWorkingCopy(modelId);
  }
  return workingCopyManager.getModel(modelId);
};

const bindGetModel = <K>(
  workingCopyManager: WorkingCopyManager<K>,
  modelIds: K[]
): ((modelId: K) => object | undefined) => {
  if (workingCopyManager.isOpen(modelIds)) {
    return workingCopyManager.getWorkingCopy.bind(workingCopyManager);
  }
  return workingCopyManager.getModel.bind(workingCopyManager);
};

/**
 * Safely invoke a call-back, reporting any uncaught exception that it
 * may throw, to ensure that subsequent subscriptions don't miss out.
 */
const safeCallback = <F extends (...args: unknown[]) => void>(
  callback: F,
  ...args: Parameters<F>
): void => {
  try {
    callback(...args);
  } catch (error) {
    console.error('Uncaught exception in CoreCommandStack call-back.', error);
  }
};

const can = <Op extends UndoRedoOp>(op: Op): Can<Op> => {
  return (op === 'redo' ? 'canRedo' : 'canUndo') as Can<Op>;
};

export function getModelIds<K>(command: Command<K>): K[] {
  if (isCompoundCommand(command)) {
    return Array.from(new Set(command.map((leaf) => leaf.modelId)));
  } else {
    return [command.modelId];
  }
}
