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

import type {
  Command,
  CommandResult,
  CoreCommandStack,
  EditingContext,
} from '../core';

/**
 * Function type for the `onCommandStackChanged` call-back of a `CommandStackSubscription`.
 *
 * @callback EditingContextChangedCallback
 *
 * @template K the type of key with which a command stack associates models
 *
 * @param eventType the type of change that occurred in the command stack
 * @param [command] the command, if any, related to the change. Only the `'flushed'` event does not include a `command`
 */
export type CommandStackChangedCallback<K> = (
  eventType: 'executed' | 'undone' | 'redone' | 'flushed',
  command?: Command<K>
) => void;

/**
 * Function type for the `onDirtyStateChanged` call-back of a `CommandStackSubscription`.
 *
 * @callback DirtyStateChangedCallback
 *
 * @template K the type of key with which a command stack associates models
 *
 * @param dirtyStateChanges for each model ID whose dirty state has changed, whether it is now dirty or not
 */
export type DirtyStateChangedCallback<K> = (
  dirtyStateChanges: Map<K, boolean>
) => void;

/**
 * A subscription to changes in the state of a {@link CommandStack}.
 * When the subscription is no longer needed, it should be `close()`d
 * to avoid the overhead of continuing to notify it.
 *
 * @template K the type of key with which a command stack associates models
 */
export interface CommandStackSubscription<K> {
  /**
   * A function to call to notify the client of editing context changes.
   */
  onCommandStackChanged?: CommandStackChangedCallback<K>;

  /**
   * A function to call to notify the client of dirty state changes.
   */
  onDirtyStateChanged?: DirtyStateChangedCallback<K>;

  /**
   * Stop receiving notifications of model changes.
   */
  close(): void;
}

/**
 * Options for configuration of the command stacks obtains from a {@link ModelManager}.
 */
export type CommandStackOptions = {
  /**
   * Whether the command stack keeps a history of commands for undo/redo.
   *
   * @default true
   */
  keepHistory?: boolean;
};

/** Default values of all command-stack options. */
const commandStackOptionsDefaults: Required<CommandStackOptions> = {
  keepHistory: true,
};

/**
 * Complete the incoming `options` with defaults for any not specified.
 *
 * @param [options] the options, if any, to complete
 * @returns the completed `options`, filled out with defaults where necessary
 */
const defaultCommandStackOptions = <T extends CommandStackOptions>(
  options: T
): Required<T> =>
  ({ ...commandStackOptionsDefaults, ...options } as Required<T>);

/**
 * An ordered history of the execution of commands on the models managed by a `ModelManager`.
 *
 * @template K the type of model ID used by the Model Manager
 */
export interface CommandStack<K = string> {
  /**
   * Execute a command on the stack.
   * If successful, that command becomes the next available to {@link undo}.
   *
   * The result is a mapping of commands to the changes that they applied to their target models,
   * which accounts for the case that the `command` is a compound.
   *
   * @param command a command to execute
   * @returns a description of the changes performed by the `command`, if available
   * @throws if the `command` is not executable
   */
  execute(command: Command<K>): CommandResult<K>;

  /**
   * Execute a command and append it to the command most recently executed.
   * If successful, that command is integrated into the appended command for {@link undo} and {@link redo}.
   *
   * As for {@link execute}, the result is a mapping of commands to the changes that they applied to their
   * target models, which accounts for the case that the `command` is a compound.
   *
   * @param command a command to execute and append onto the last executed command
   * @returns a description of the changes performed by the `command`, if available
   * @throws if the `command` is not executable or if there has been no command
   *  executed to append to
   */
  executeAndAppend(command: Command<K>): CommandResult<K>;

  /**
   * Undo the command most recently executed/redone.
   * If successful, that command becomes the next available to {@link redo}.
   *
   * @returns a description of the changes performed by undo, if available
   * @throws if there is no command to undo or if that command is not undoable
   *
   * @see {@link getUndoCommand}
   * @see {@link canUndo}
   */
  undo(): CommandResult<K>;

  /**
   * Redo the command most recently undone.
   * If successful, that command becomes the next available to {@link undo}.
   *
   * @returns a description of the changes performed by redo, if available
   * @throws if there is no command to redo or if that command is not redoable
   *
   * @see {@link getRedoCommand}
   * @see {@link canRedo}
   */
  redo(): CommandResult<K>;

  /**
   * Query whether a `command` can be executed.
   *
   * @param command a command to be executed
   * @returns whether the `command` can be executed
   * @see {@link execute}
   */
  canExecute(command: Command<K>): Promise<boolean>;

  /**
   * Query whether there is some command available to undo that can be undone.
   *
   * @returns whether the stack has a command to undo and that command is undoable
   * @see {@link getUndoCommand}
   */
  canUndo(): Promise<boolean>;

  /**
   * Query whether there is some command available to redo that can be redone.
   *
   * @returns whether the editing `context` has a command to redo and that command is redoable
   * @see {@link getRedoCommand}
   */
  canRedo(): Promise<boolean>;

  /**
   * Query what is the next command that would be undone by a request to {@link undo}.
   *
   * @returns the next undoable command, or `undefined` if none
   */
  getUndoCommand(): Command<K> | undefined;

  /**
   * Query what is the next command that would be redone by a request to {@link redo}.
   *
   * @returns the next redoable command, or `undefined` if none
   */
  getRedoCommand(): Command<K> | undefined;

  /**
   * Flush the stack.
   * All commands in the undo and redo history are removed and are returned
   * in the (temporal) order in which they were originally executed.
   *
   * @return the commands that were purged from the stack, or an empty array if none
   */
  flush(): Command<K>[];

  /**
   * Mark the the current top of the stack as the point where the models that
   * are edited in this context have been saved.
   * This should be done by a client that has saved those models to
   * persistent storage.
   *
   * @see {@link isDirty}
   * @see {@link getDirtyModels}
   */
  markSaved(): void;

  /**
   * Queries whether any commands have been executed, undone, or redone since
   * the last {@link markSaved save}.
   *
   * @returns whether I am dirty
   *
   * @see {@link markSaved}
   * @see {@link getDirtyModelIds}
   */
  isDirty(): boolean;

  /**
   * Query the IDs of models that have been modified by execution, undo, and redo
   * of commands since the last {@link markSaved save}.
   * This may include models that are assumed to be dirty because they were
   * modified at the time this `context` was last flushed.
   *
   * @see {@link markSaved}
   * @see {@link isDirty}
   */
  getDirtyModelIds(): K[];

  /**
   * Create a subscription to changes occurring in the command stack.
   * Each call creates a new subscription that, when no longer needed, {@link CommandStackSubscription.close should be closed} separately.
   *
   * @returns the command-stack subscription
   */
  subscribe(): CommandStackSubscription<K>;

  /**
   * Get the core stack underlying this command stack, for access to its advanced capabilities.
   *
   * @returns the core stack
   */
  getCoreCommandStack(): CoreCommandStack<K>;
}

/**
 * The implementation of the command stack wraps a {@link CoreCommandStack} and adds a private
 * {@link EditingContext} to all operation delegation.
 *
 * @template K the type of model ID used by the Model Manager
 */
export class CommandStackImpl<K = string> implements CommandStack<K> {
  /** The editing context that represent me in the shared delegate stack. */
  private readonly editingContext: EditingContext;

  /** My configuration options, defaulted where necessary to provide them all. */
  private readonly options: Required<CommandStackOptions>;

  /**
   * Initializes me with the core command stack to which I `delegate` my implementation
   * and my unique `id` that I use as my editing context in the core command stack.
   *
   * @param delegate the core command stack to which I delegate my API with my editing context
   * @param id my identifier, which I use as my editing context
   */
  constructor(
    private readonly delegate: CoreCommandStack<K>,
    options: CommandStackOptions & { id: string }
  ) {
    const { id, ...otherOptions } = defaultCommandStackOptions(options);
    this.editingContext = id;
    this.options = otherOptions;
  }

  execute(command: Command<K>): CommandResult<K> {
    const result = this.delegate.execute(command, this.editingContext);
    if (!this.options.keepHistory) {
      // Discard the history on completion or failure
      return result.finally(() => this.flush());
    }
    return result;
  }

  executeAndAppend(command: Command<K>): CommandResult<K> {
    // If we don't keep history, this will fail because there's no undo command
    // to append to, which is all correct.
    return this.delegate.executeAndAppend(this.editingContext, command);
  }

  undo(): CommandResult<K> {
    return this.delegate.undo(this.editingContext);
  }

  redo(): CommandResult<K> {
    return this.delegate.redo(this.editingContext);
  }

  canExecute(command: Command<K>): Promise<boolean> {
    return this.delegate.canExecute(command, this.editingContext);
  }

  canUndo(): Promise<boolean> {
    return this.delegate.canUndo(this.editingContext);
  }

  canRedo(): Promise<boolean> {
    return this.delegate.canRedo(this.editingContext);
  }

  getUndoCommand(): Command<K> | undefined {
    return this.delegate.getUndoCommand(this.editingContext);
  }

  getRedoCommand(): Command<K> | undefined {
    return this.delegate.getRedoCommand(this.editingContext);
  }

  flush(): Command<K>[] {
    return this.delegate.flush(this.editingContext);
  }

  markSaved(): void {
    this.delegate.markSaved(this.editingContext);
  }

  isDirty(): boolean {
    return this.delegate.isDirty(this.editingContext);
  }

  getDirtyModelIds(): K[] {
    return this.delegate.getDirtyModelIds(this.editingContext);
  }

  subscribe(): CommandStackSubscription<K> {
    const sub = this.delegate.subscribe(this.editingContext);
    const result: CommandStackSubscription<K> = {
      close: sub.close.bind(sub),
    };

    sub.onContextChanged = (_, eventType, command) =>
      result.onCommandStackChanged?.(eventType, command);
    sub.onDirtyStateChanged = (_, dirtyStateChanges) =>
      result.onDirtyStateChanged?.(dirtyStateChanges);

    return result;
  }

  getCoreCommandStack(): CoreCommandStack<K> {
    return this.delegate;
  }
}
