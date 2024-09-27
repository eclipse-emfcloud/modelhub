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
import { Trigger } from './trigger';

import { cloneDeep } from 'lodash';

/**
 * An engine for computation of further patches to a JSON document based
 * on ("triggered by") changes previously captured.
 */
export interface TriggerEngine {
  /**
   * Add a trigger that provides new patches to follow up triggering changes.
   *
   * @param trigger a trigger to add
   * @template T the JSON document type
   */
  addTrigger<T extends object = object>(trigger: Trigger<T>): void;

  /**
   * Compute the totality of additional changes to follow up the changes
   * previously applied to a `document` that are described by a given
   * `delta`.
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
   *   or `undefined` if no follow-up is provided. The resulting patch, if any,
   *   is invertible according to `fast-json-patch` semantics of invertibility
   */
  applyTriggers(
    document: NonNullable<object>,
    delta: Operation[],
    previousDocument: NonNullable<object>
  ): Promise<Operation[] | undefined>;
}

/**
 * Options for configuration of the default trigger engine implementation.
 */
export interface TriggerEngineOptions {
  /**
   * Whether to clone patches provided by triggers before applying them,
   * to avoid objects that they contain being modified in situ by
   * subsequent patches. This is only necessary if triggers will
   * reuse or otherwise retain the patches that they provide.
   *
   * Default is `false`.
   */
  safePatches?: boolean;

  /**
   * A limit to the number of iterations of triggers that the engine
   * will perform before assuming that some trigger(s) is/are inducing
   * an unbounded oscillation that needs to be aborted.
   *
   * Default is `1000`. Minimum is `50`.
   */
  iterationLimit?: number;

  /**
   * Run triggers effectively in parallel, meaning that, at each iteration
   *
   * - all triggers are executed on the same state of the model with the same delta
   * - the patches they return are all applied at once to the working state of the
   *   model to seed the next iteration
   * - within each iteration, triggers _do not see_ the effects of triggers that
   *   run before them
   *
   * This implies that, in parallel mode, it does not make sense to have
   * ordering dependencies between triggers and the order in which they
   * are run must not matter.
   *
   * Default is `false`, meaning strictly serial execution of triggers that each
   * see all results of previous triggers, with the concomitant cost of copying
   * and comparing model states to calculate inputs to each next trigger.
   */
  parallel?: boolean;
}

/**
 * A default implementation of the `TriggerEngine`.
 */
export class TriggerEngineImpl implements TriggerEngine {
  private readonly _triggers = new Array<Trigger<object>>();
  private readonly _safePatches: boolean;
  private readonly _iterationLimit: number;

  public readonly applyTriggers: TriggerEngine['applyTriggers'];

  constructor(options?: TriggerEngineOptions) {
    this._safePatches = options?.safePatches ?? false;
    this._iterationLimit = options?.iterationLimit ?? 1000;
    this.applyTriggers =
      options?.parallel === true
        ? this.applyTriggersInParallel
        : this.applyTriggersInStrictSequence;

    if (this._iterationLimit < 50) {
      throw new Error(`Iteration limit too low: ${this._iterationLimit} < 50`);
    }
  }

  addTrigger<T extends object = object>(trigger: Trigger<T>): void {
    this._triggers.push(trigger);
  }

  protected async applyTriggersInStrictSequence(
    document: NonNullable<object>,
    delta: Operation[],
    previousDocument: NonNullable<object>
  ): Promise<Operation[] | undefined> {
    // The working copy is continually updated by patches from triggers
    const workingCopy = this.createWorkingCopy(document);

    // Every trigger invocation gets the "before image" which is the
    // state the document was in before it evolved into the "working copy"
    // via the patches describing those changes. And the deltas that it
    // gets start with the patch that evolved the "before image" into the
    // initial "working copy" state (as seeded from the "document")
    const initialBeforeImage = this.createWorkingCopy(previousDocument);
    const initialDelta = delta;
    const triggerIterations = new Map<Trigger<object>, NonNullable<object>>();

    let i = 0;
    let rollingBeforeImage = this.createWorkingCopy(document);
    let deltaBasis = initialBeforeImage;
    let workingCopyGeneration = 0;
    let deltaGeneration = workingCopyGeneration;
    let rollingDelta = initialDelta;

    for (; i < this._iterationLimit; i++) {
      // Track whether this iteration over the triggers changes anything
      let changedInThisIteration = false;

      for (const trigger of this._triggers) {
        const beforeImage =
          triggerIterations.get(trigger) ?? initialBeforeImage;
        let triggerDelta: Operation[];

        // Don't recompute the delta if we can reuse the current
        if (
          deltaBasis === beforeImage &&
          deltaGeneration === workingCopyGeneration
        ) {
          triggerDelta = rollingDelta;
        } else {
          triggerDelta = this.compare(beforeImage, workingCopy);

          deltaBasis = beforeImage;
          deltaGeneration = workingCopyGeneration;
          rollingDelta = triggerDelta;
        }

        // If there were no delta, then there would have been not changes in
        // the previous iteration and we would have stopped before now.
        const triggerPatch = await trigger(
          workingCopy,
          triggerDelta,
          beforeImage
        );

        if (triggerPatch && triggerPatch.length) {
          changedInThisIteration = true;

          // Capture the current state in the rolling "before image"
          rollingBeforeImage = this.createWorkingCopy(workingCopy);

          // Update the working copy for the next trigger
          this.applyPatch(workingCopy, triggerPatch);
          workingCopyGeneration++;
        }

        // Record the trigger's "before image" for the next iteration
        triggerIterations.set(trigger, rollingBeforeImage);
      }

      if (!changedInThisIteration) {
        // Done with iterating triggers as this iteration through them produced
        // no new changes
        break;
      }
    }

    if (i >= this._iterationLimit) {
      throw new Error(
        `Trigger iteration limit of ${this._iterationLimit} exceeded`
      );
    }

    // Compute an optimized delta, considering that maybe the
    // sum of all the patches is zero
    const result = i > 0 ? this.compare(document, workingCopy) : [];
    return result.length ? result : undefined;
  }

  protected async applyTriggersInParallel(
    document: NonNullable<object>,
    delta: Operation[],
    previousDocument: NonNullable<object>
  ): Promise<Operation[] | undefined> {
    const workingCopy = this.createWorkingCopy(document);
    let beforeImage = this.createWorkingCopy(previousDocument);
    let patched = false;
    let workingCopyDelta = delta;
    let i = 0;

    for (; i < this._iterationLimit; i++) {
      const nextPatch: Operation[] = [];

      for (const trigger of this._triggers) {
        const triggerPatch = await trigger(
          workingCopy,
          workingCopyDelta,
          beforeImage
        );
        if (triggerPatch && triggerPatch.length) {
          nextPatch.push(...triggerPatch);
        }
      }

      if (nextPatch.length === 0) {
        break;
      }

      patched = true;
      // Retain the previous state of the working copy for the next iteration
      beforeImage = this.createWorkingCopy(workingCopy);
      // Update the working copy for the next round of iteration
      this.applyPatch(workingCopy, nextPatch);
      // Recompute the delta to normalize the patch and eliminate '-' pseudoindices
      workingCopyDelta = this.compare(beforeImage, workingCopy);
    }

    if (i >= this._iterationLimit) {
      throw new Error(
        `Trigger iteration limit of ${this._iterationLimit} exceeded`
      );
    }

    // Compute an optimized delta, considering that maybe the
    // sum of all the patches is zero
    const result = patched ? this.compare(document, workingCopy) : [];
    return result.length ? result : undefined;
  }

  /**
   * Create a working copy of the given `document` that it is safe to
   * modify by patching, to compute further patches from triggers.
   *
   * @param document the document to be patched
   * @returns a safely patchable working copy of the `document`
   */
  protected createWorkingCopy(
    document: NonNullable<object>
  ): NonNullable<object> {
    return cloneDeep(document);
  }

  /**
   * Apply a patch to the working copy of the document under computation.
   *
   * @param workingCopy the working copy of the document on which triggers are being computed
   * @param patch  a patch to apply to the working copy
   */
  protected applyPatch(
    workingCopy: NonNullable<object>,
    patch: Operation[]
  ): void {
    const patchToApply = this._safePatches ? cloneDeep(patch) : patch;
    applyPatch(workingCopy, patchToApply, true, true);
  }

  /**
   * Compare a `document` with the `workingCopy` evolved from it to produce a patch
   * describing the total changes to be applied to the `document` to effect the
   * totality of triggered follow-ups changes.
   *
   * @param document the original document for which triggers are computed
   * @param workingCopy the working copy resulting from iterative application of triggers
   * @returns the delta between the `document` as pre-image and the `workingCopy` as post-image
   */
  protected compare(
    document: NonNullable<object>,
    workingCopy: NonNullable<object>
  ): Operation[] {
    return compare(document, workingCopy, true);
  }
}
