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

import type { Command, CommandResult } from './command';
import type { CoreCommandStackSubscription } from './command-stack-subscription';
import type { EditingContext } from './editing-context';

/**
 * Enumeration of the operations for which a command stack maintains history.
 */
export type UndoRedoOp = 'undo' | 'redo';
/**
 * A type derived from any operation that is the indication of whether that
 * operation _can_ be performed.
 */
export type Can<Op extends string> = `can${Capitalize<Op>}`;

/**
 * An analysis report of the undo/redo state of some {@link EditingContext} in the {@link CoreCommandStack}.
 * The report is summarized by a `boolean` property named either `canUndo` or `canRedo` according to whether
 * the analysis was for the undo or redo of an editing context and in addition has details about context
 * dependencies, if applicable.
 *
 * @see {@link CoreCommandStack.analyzeUndo()}
 * @see {@link CoreCommandStack.analyzeRedo()}
 */
export type CommandAnalysis<Op extends UndoRedoOp> = Record<
  Can<Op>,
  boolean
> & {
  /**
   * Whether the performability of undo/redo is contingent on dependencies on other contexts.
   * Those dependencies, if any, are included in the `contexts` object.
   */
  hasDependencies: boolean;
  /**
   * A convenient message summarizing the analysis result.
   */
  summary: string;
  /**
   * An object indicating per editing context whether that context is undoable or not.
   * This includes the initial context that was analyzed and also any that its undo or redo depends
   * on also being undone or redone. This lets a client know the reason why a context, even accounting
   * for dependencies, is not undoable or redoable.
   * Note that the editing context for which the analysis was requested may itself not be undoable or
   * redoable even if all of its dependencies are.
   * This object will always include at least the editing context that was analyzed, and only that
   * if it has no dependencies.
   */
  contexts: Record<EditingContext, boolean>;
};
/** The analysis report for undo of an editing context. */
export type UndoAnalysis = CommandAnalysis<'undo'>;
/** The analysis report for redo of an editing context. */
export type RedoAnalysis = CommandAnalysis<'redo'>;

/**
 * An ordered history of the execution of commands on the models managed by a `CoreModelManager`.
 *
 * @template K the type of model ID used by the Model Manager
 */
export interface CoreCommandStack<K = string> {
  /**
   * Execute a command in one or more editing `contexts`.
   * If successful, that command becomes the next available to {@link undo}.
   *
   * The result is a mapping of commands to the changes that they applied to their target models,
   * which accounts for the case that the `command` is a compound.
   *
   * @param command a command to execute
   * @param contexts one or more editing contexts to associate with the execution of the `command`
   * @returns a description of the changes performed by the `command`, if available
   * @throws if the `command` is not executable or if no `contexts` are specified
   */
  execute(command: Command<K>, ...contexts: EditingContext[]): CommandResult<K>;

  /**
   * Execute a command in one or more editing `contexts` and append it to the command most
   * recently executed in the given appended context.
   * If successful, that command is integrated into the appended command for {@link undo} and {@link redo}
   * and the appended command's editing contexts are united with the given additional `contexts`.
   *
   * As for {@link execute}, the result is a mapping of commands to the changes that they applied to their
   * target models, which accounts for the case that the `command` is a compound.
   *
   * @param appendContext the editing context in which to append the `command` to its most recently executed command
   * @param command a command to execute
   * @param contexts one or more editing contexts to associate with the execution of the `command`
   * @returns a description of the changes performed by the `command`, if available
   * @throws if the `command` is not executable, if no `contexts` are specified, or if there has been no command
   *  executed in the given appended context
   */
  executeAndAppend(
    appendedContext: EditingContext,
    command: Command<K>,
    ...contexts: EditingContext[]
  ): CommandResult<K>;

  /**
   * Undo the command most recently executed/redone in the given editing `context`.
   * If successful, that command becomes the next available to {@link redo}.
   * Moreover, if `withDependencies` is `true` and there are dependencies that have to
   * be undone before the `context` command, then they are aggregated together with it in
   * a new compound that replaces them all atop the redo stack.
   *
   * @param context the editing context to undo
   * @param [withDependencies] whether to include dependencies if there are any.
   *   The default is `true`. Pass `false` to reject undo if there are dependencies
   * @returns a description of the changes performed by undo, if available
   * @throws if there is no command to undo in the given `context` or if that command is not undoable
   *
   * @see {@link getUndoCommand}
   * @see {@link canUndo}
   */
  undo(context: EditingContext, withDependencies?: boolean): CommandResult<K>;

  /**
   * Redo the command most recently undone in the given editing `context`.
   * If successful, that command becomes the next available to {@link undo}.
   * Moreover, if `withDependencies` is `true` and there are dependencies that have to
   * be redone before the `context` command, then they are aggregated together with it in
   * a new compound that replaces them all atop the redo stack.
   *
   * @param context the editing context to redo
   * @param [withDependencies] whether to include dependencies if there are any.
   *   The default is `true`. Pass `false` to reject redo if there are dependencies
   * @returns a description of the changes performed by redo, if available
   * @throws if there is no command to redo in the given `context` or if that command is not redoable
   *
   * @see {@link getRedoCommand}
   * @see {@link canRedo}
   */
  redo(context: EditingContext, withDependencies?: boolean): CommandResult<K>;

  /**
   * Query whether a `command` can be executed in the given editing `context`s.
   *
   * @param command a command to be executed
   * @param contexts the editing contexts in which the command is to be executed
   * @returns whether the `command` can be executed in the editing `context`s
   * @see {@link execute}
   */
  canExecute(
    command: Command<K>,
    ...contexts: EditingContext[]
  ): Promise<boolean>;

  /**
   * Query whether a given editing `context` has a command that can be undone.
   *
   * @param context the editing context to undo
   * @param [withDependencies] whether to include dependencies if there are any.
   *   The default is `true`. Pass `false` to refuse undo if there are dependencies
   * @returns whether the editing `context` has a command to undo and that command is undoable
   * @see {@link getUndoCommand}
   */
  canUndo(
    context: EditingContext,
    withDependencies?: boolean
  ): Promise<boolean>;

  /**
   * Analyze the undoability of the {@link getUndoCommand undo command} for a given editing `context`.
   *
   * @param context and editing context that may or may not {@link canUndo be undoable}
   * @returns a detailed analysis of the undoability of the context
   * @see {@link getUndoCommand()}
   * @see {@link canUndo()}
   */
  analyzeUndo(context: EditingContext): Promise<UndoAnalysis>;

  /**
   * Query whether a given editing `context` has a command that can be redone.
   *
   * @param context the editing context to redo
   * @param [withDependencies] whether to include dependencies if there are any.
   *   The default is `true`. Pass `false` to refuse redo if there are dependencies
   * @returns whether the editing `context` has a command to redo and that command is redoable
   * @see {@link getRedoCommand}
   */
  canRedo(
    context: EditingContext,
    withDependencies?: boolean
  ): Promise<boolean>;

  /**
   * Analyze the redoability of the {@link getRedoCommand redo command} for a given editing `context`.
   *
   * @param context and editing context that may or may not {@link canRedo be redoable}
   * @returns a detailed analysis of the redoability of the context
   * @see {@link getRedoCommand()}
   * @see {@link canRedo()}
   */
  analyzeRedo(context: EditingContext): Promise<RedoAnalysis>;

  /**
   * Query what is the next command that would be undone by a request to {@link undo} a given editing `context`.
   *
   * @param context the editing context to undo
   * @returns the next undoable command in the editing `context`, or `undefined` if none
   */
  getUndoCommand(context: EditingContext): Command<K> | undefined;

  /**
   * Query what is the next command that would be redone by a request to {@link redo} a given editing `context`.
   *
   * @param context the editing context to redo
   * @returns the next redoable command in the editing `context`, or `undefined` if none
   */
  getRedoCommand(context: EditingContext): Command<K> | undefined;

  /**
   * Flush an editing `context`.
   * The given `context` is removed from the history of all commands that were associated with it.
   * Any commands that are then left without any associated editing contexts are purged from the stack
   * and returned to the caller.
   *
   * @param context an editing context to flush
   * @return the commands that were purged from the stack, or an empty array if none
   */
  flush(context: EditingContext): Command<K>[];

  /**
   * Mark an editing `context` as having been saved.
   * This should be done by a client that has saved the models edited in that `context`
   * to persistent storage.
   *
   * @param editingContext a context to mark as saved
   *
   * @see {@link isDirty}
   * @see {@link getDirtyModels}
   */
  markSaved(editingContext: EditingContext): void;

  /**
   * Queries whether any commands have been executed, undone, or redone
   * in the given context since it was last {@link markSaved saved}.
   *
   * @param editingContext a context to test for dirty state
   * @returns whether it is dirty
   *
   * @see {@link markSaved}
   * @see {@link getDirtyModelIds}
   */
  isDirty(editingContext: EditingContext): boolean;

  /**
   * Query the IDs of models that have been modified by execution, undo, and redo
   * of commands in the given `context` since the last {@link markSaved save}.
   * This may include models that are assumed to be dirty because they were
   * modified at the time this `context` was last flushed.
   *
   * @param editingContext an editing context for which to obtain the dirty models
   *
   * @see {@link markSaved}
   * @see {@link isDirty}
   */
  getDirtyModelIds(editingContext: EditingContext): K[];

  /**
   * Query the editing contexts that currently have associated command histories and/or dirty state.
   * If an editing context has been {@linkplain flush flushed} but still {@linkplain getDirtyModels is dirty}, then it will be returned in the result.
   * Otherwise, the editing context effectively no longer exists and will not be returned in the result.
   */
  getEditingContexts(): EditingContext[];

  /**
   * Create a subscription to the changes occurring in a particular editing context or all contexts.
   * Each call creates a new subscription that, when no longer needed, {@link CoreCommandStackSubscription.close should be closed} separately.
   *
   * If an `editingContext` is specified, notifications of changes only in that context will be sent to the
   * resulting subscription.
   * Otherwise, it will receive notification of changes to all contexts.
   *
   * The `editingContext` needs not necessarily be associated with any command history at the time of subscription.
   * The subscription will simply never receive notifications until such time as the context begins to see operations on commands.
   *
   * @param [editingContext] the optional editing context to which to subscribe.
   *    If omitted or `undefined`, the subscription will notify on changes to all editing contexts that I manage
   * @returns the command-stack subscription
   */
  subscribe(editingContext?: EditingContext): CoreCommandStackSubscription<K>;
}
