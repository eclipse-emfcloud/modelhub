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

/** The type of `severity` of a `Diagnostic`. */
export type Severity = 'ok' | 'info' | 'warn' | 'error';

/**
 * Obtain a numeric encoding of a `severity`.
 *
 * @param severity a severity
 * @returns a numeric analogue of the `severity`
 */
export const severityToNumber = (severity: Severity): number => {
  switch (severity) {
    case 'ok':
      return 0;
    case 'info':
      return 1;
    case 'warn':
      return 2;
    default:
      // Assume the worst for any other input
      return 4;
  }
};

/** The subdomain of the numbers that denote sign of numbers. */
export type Sign = -1 | 0 | 1;

/**
 * A comparator function for {@link Severity} values to order them
 * from least severe (being `'ok'`) to most severe (being `'error'`).
 */
export const severityComparator = (a: Severity, b: Severity): Sign => {
  return Math.sign(severityToNumber(a) - severityToNumber(b)) as Sign;
};

/**
 * A severity maximum function.
 *
 * @param a a severity
 * @param b another severity
 * @returns the maximum of `a` and `b`
 */
severityComparator.max = (a: Severity, b: Severity): Severity => {
  switch (severityComparator(a, b)) {
    case -1:
      return b;
    default:
      return a;
  }
};
