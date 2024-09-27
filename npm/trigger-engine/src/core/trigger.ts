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

import {
  AddOperation,
  Operation,
  RemoveOperation,
  ReplaceOperation,
  TestOperation,
} from 'fast-json-patch';

/** The eventual type of a trigger result. */
export type TriggerPatch = Operation[] | undefined;

/** The result of a trigger, which is optionally asynchronous. */
export type TriggerResult = TriggerPatch | Promise<TriggerPatch>;

/**
 * Protocol for a calculation of an update to an object consequent of some patch
 * to it.
 *
 * @template T the JSON document type
 */
export interface Trigger<T extends object = object> {
  /**
   * Get a new patch, if necessary, that would apply further changes to
   * a given `document` consequent from changes previously applied to it,
   * described by the given `delta`.
   *
   * @param document a JSON document that has been updated. This document is in the _after_
   *   state with respect to the `delta`, which is to say that it has already been
   *   updated as described by the delta
   * @param delta a patch describing the changes that were applied to it. The `delta`
   *   may include `test` assertion operations. It is guaranteed to comprise at least
   *   one operation that is not a `test`
   * @param previousDocument the JSON `document` as it was before the changes described by
   *   the `delta` were performed on it. Thus, this is the _before_ state with respect to
   *   that `delta`
   * @returns a new patch, applicable to the current state of the `document`, describing
   *   additional changes that should be applied to it to follow up the triggering `delta`,
   *   or `undefined` if no follow-up is provided. Any patch returned should be invertible
   *   according to the `fast-json-patch` semantics of invertibility
   */
  (
    document: NonNullable<T>,
    delta: Operation[],
    previousDocument: NonNullable<T>
  ): TriggerResult;
}

/** A JSON patch operation that is anything but a `'test'` operation. */
export type NonTestOperation = Exclude<Operation, TestOperation<never>>;

/**
 * Extract the operations from a patch that are not `'test'` operations, for ease of analysis.
 *
 * @param patch a JSON patch
 * @returns the non-`'test'` operations
 */
export function nonTestOperations(patch: Operation[]): NonTestOperation[] {
  return patch.filter((op) => op.op !== 'test');
}

/**
 * Extract the operations from a patch that are `'add'` operations, for ease of analysis.
 *
 * @param patch a JSON patch
 * @param valueGuard an optional type guard on the value of the add and remove patches to select
 * @returns the `'add'` operations, optionally matching the type guard on the value
 */
export function addOperations<T = unknown>(
  patch: Operation[],
  valueGuard?: (value: unknown) => value is T
): AddOperation<T>[] {
  if (valueGuard) {
    return patch.filter(
      (op) => op.op === 'add' && valueGuard(op.value)
    ) as AddOperation<T>[];
  }

  return patch.filter((op) => op.op === 'add') as AddOperation<T>[];
}

/**
 * Extract the operations from a patch that are `'add'` or `'replace'` operations, for ease of analysis.
 *
 * @param patch a JSON patch
 * @param valueGuard an optional type guard on the value of the add and remove patches to select
 * @returns the `'add'` and `'replace'` operations, optionally matching the type guard on the value
 */
export function addOrReplaceOperations<T = unknown>(
  patch: Operation[],
  valueGuard?: (value: unknown) => value is T
): (AddOperation<T> | ReplaceOperation<T>)[] {
  if (valueGuard) {
    return patch.filter(
      (op) => (op.op === 'add' || op.op === 'replace') && valueGuard(op.value)
    ) as (AddOperation<T> | ReplaceOperation<T>)[];
  }

  return patch.filter((op) => op.op === 'add' || op.op === 'replace') as (
    | AddOperation<T>
    | ReplaceOperation<T>
  )[];
}

/**
 * Extract the operations from a patch that are `'remove'` operations, for ease of analysis.
 *
 * @param patch a JSON patch
 * @returns the `'remove'` operations
 */
export function removeOperations(patch: Operation[]): RemoveOperation[] {
  return patch.filter((op) => op.op === 'remove') as RemoveOperation[];
}
