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

import type { Command } from '../core/command';
import type { EditingContext } from './editing-context';

/**
 * Function type for the `onContextChanged` call-back of a `CoreCommandStackSubscription`.
 *
 * @callback EditingContextChangedCallback
 *
 * @template K the type of key with which a command stack associates models
 *
 * @param editingContext the editing context that changed
 * @param eventType the type of change that occurred in the command stack
 * @param [command] the command, if any, related to the change. Only the `'flushed'` event does not include a `command`
 */
export type EditingContextChangedCallback<K> = (
  editingContext: EditingContext,
  eventType: 'executed' | 'undone' | 'redone' | 'flushed',
  command?: Command<K>
) => void;

/**
 * Function type for the `onDirtyStateChanged` call-back of a `CoreCommandStackSubscription`.
 *
 * @callback DirtyStateChangedCallback
 *
 * @template K the type of key with which a command stack associates models
 *
 * @param editingContext the editing context that changed
 * @param dirtyStateChanges for each model ID whose dirty state has changed, whether it is now dirty or not
 */
export type DirtyStateChangedCallback<K> = (
  editingContext: EditingContext,
  dirtyStateChanges: Map<K, boolean>
) => void;

/**
 * A subscription to changes in the state of a {@link CoreCommandStack}.
 * When the subscription is no longer needed, it should be `close()`d
 * to avoid the overhead of continuing to notify it.
 *
 * @template K the type of key with which a command stack associates models
 */
export interface CoreCommandStackSubscription<K> {
  /**
   * A function to call to notify the client of editing context changes.
   */
  onContextChanged?: EditingContextChangedCallback<K>;

  /**
   * A function to call to notify the client of dirty state changes.
   */
  onDirtyStateChanged?: DirtyStateChangedCallback<K>;

  /**
   * Stop receiving notifications of model changes.
   */
  close(): void;
}
