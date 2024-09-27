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

import { Severity, severityComparator } from './severity';

/**
 * A report of the validation state of some element in the model, or the model
 * overall if the `path` is `''`.
 */
export interface Diagnostic {
  /**
   * The severity of the problem. An `'ok'` severity indicates that no problem
   * is manifest.
   */
  severity: Severity;

  /**
   * The source of the problem, indicating the component that reported it.
   * Semantics of the source is application-specific but it must not be the empty string.
   */
  source: string;

  /**
   * A code identifying the particular validation rule that reported a problem.
   * May be omitted for `ok` {@link severity} diagnostics and for "roll-ups"
   * that have {@link children}.
   */
  code?: string;

  /**
   * A JSON Pointer indicating the object within the model with which the diagnostic
   * is associated. Thus a diagnostic for the model as a whole has the `''` path.
   * An array indices in the path must be specific, not `-`.
   */
  path: string;

  /**
   * A message describing the problem that is suitable for presentation to a human user.
   * Likewise if the {@link severity} is `'ok`'.
   */
  message: string;

  /**
   * An optional blob of information providing details about the problem.
   * The schema for the data is application-specific and may vary according to
   * {@link source} and/or {@link code}.
   */
  data?: unknown;

  /**
   * An optional array of child diagnostics breaking down the validation state
   * of the object identified by the {@link path} into finer detail. Typically
   * used to represent a "roll-up" validation state for some subtree of the
   * model or the model in its entirety.
   *
   * A diagnostic that has children must not, itself, indicate a discrete problem.
   * Instead, any problem specific to the object identified by the {@link path}
   * should be included in these children. A diagnostic that has children
   * must have a {@link severity} that is the maximum of the severities of those
   * children.
   */
  children?: Diagnostic[];
}

/**
 * A type of `Diagnostic` that is guaranteed to have a `children` array.
 * Used internally only by the merge algorithm. Not exported to clients.
 */
type MultiDiagnostic = Diagnostic & { children: Diagnostic[] };

/** A default diagnostic source to assign when none other is available. */
const DEFAULT_SOURCE = '@eclipse-emfcloud/model-validation';

/**
 * Obtain a diagnostic of `'ok'` severity indicating that validation found no problem.
 *
 * @param [source] an optional source for the resulting diagnostic.
 *   The default indicates this validation framework package
 * @return an `'ok'` diagnostic with empty (`''`) path as the path does not really matter in the absence of a problem
 */
export const ok = (source = DEFAULT_SOURCE): Diagnostic => ({
  severity: 'ok',
  message: 'OK.',
  source,
  path: '',
});

/**
 * Merge zero or more diagnostics into one. All `'ok'` diagnostics
 * are elided. As a special case, an empty list of `diagnostics`
 * or an array containing only `'ok'` diagnostics merges to an
 * {@link ok} diagnostic. As another special case, a single
 * input merges to itself.
 *
 * For any input to the merge that has {@link Diagnostic.children children},
 * those children (except any that are OK) are added to the merge result
 * in place of the original input, as that parent diagnostic is expected
 * to be the result of a previous merge by this same algorithm.
 * In consequence, consistent use of this merge function will always
 * result in a flat structure of a diagnostic with zero or more children
 * that all have themselves no children.
 *
 * In a merge result that combines multiple non-OK diagnostics from the
 * inputs, all of the following conditions hold:
 *
 * - the {@link Diagnostic.severity severity} of the merge result is the
 *   {@link severityComparator.max maximum} of the severities of its children
 * - the {@link Diagnostic.source source} of the merge result is the
 *   same as the source of its children if they all have the same source.
 *   Otherwise, it is the empty string (`''`)
 * - the {@link Diagnostic.code code} of the merge result is `undefined`
 * - the {@link Diagnostic.path path} of the merge result is the longest
 *   common prefix of all of the paths of its children, which may be
 *   their path if they all have the same path, or may be the empty string
 *   (`''`) denoting the model as a whole if they have no common prefix
 * - the {@link Diagnostic.message message} of the merge result is a
 *   non-localized string indicating how many problems it aggregates
 *
 * @param diagnostics zero or more diagnostics to merge
 * @return a compact merge of the `diagnostics`
 */
export const merge = (...diagnostics: Diagnostic[]): Diagnostic => {
  const nonOK = diagnostics.filter(notOK);
  if (!nonOK || !nonOK.length) {
    return ok();
  }
  if (nonOK.length === 1 && !hasChildren(nonOK[0])) {
    return nonOK[0];
  }

  const [first] = nonOK.splice(0, 1);
  const result: MultiDiagnostic = {
    severity: first.severity,
    source: first.source,
    path: first.path,
    message: '', // Will replace this later
    children: hasChildren(first) ? [...first.children.filter(notOK)] : [first],
  };

  nonOK.forEach((d) => {
    if (d.children !== undefined && d.children.length > 0) {
      result.children.push(...d.children.filter(notOK));
    } else {
      result.children.push(d);
    }
  });

  // After all the filtering we may now have only one child or even none.
  switch (result.children.length) {
    case 0:
      // Canonically, no problem.
      return ok();
    case 1:
      // It stands for itself.
      return result.children[0];
    default:
      // Continue, below
      break;
  }

  result.severity = result.children
    .map((d) => d.severity)
    .reduce(severityComparator.max, 'ok');
  result.path = result.children
    .slice(1)
    .map((d) => d.path)
    .reduce(longestCommonPrefix, result.children[0].path);
  result.source = unique(result.children.map((d) => d.source)) || '';

  result.message = `${result.children.length} problems found.`;

  return result;
};

/** A function determining whether a diagnostic is not OK. */
const notOK = (d: Diagnostic) => severityComparator(d.severity, 'ok') > 0;

/** A guard determining whether a diagnostic has children. */
const hasChildren = (d: Diagnostic): d is MultiDiagnostic =>
  d.children !== undefined && d.children.length > 0;

/** Compute the longest common prefix of two JSON pointers. */
const longestCommonPrefix = (path1: string, path2: string): string => {
  const segs1 = (path1 || '').split('/');
  const segs2 = (path2 || '').split('/');

  const count = Math.min(segs1.length, segs2.length);
  let prefLength = 0;
  for (; prefLength < count; prefLength++) {
    if (segs1[prefLength] !== segs2[prefLength]) {
      break;
    }
  }

  if (prefLength === 0) {
    return '';
  }

  return segs1.slice(0, prefLength).join('/');
};

/**
 * Extract the unique value of the given `items` or else
 * `undefined` if they are not unique.
 *
 * @param items some items
 * @returns the unique value, or `undefined` if `items` is empty
 */
const unique = <T>(items: T[]): T | undefined => {
  let result: T | undefined;

  for (const next of items) {
    if (result === undefined) {
      result = next;
    } else if (result !== next) {
      result = undefined;
      break;
    }
  }

  return result;
};
