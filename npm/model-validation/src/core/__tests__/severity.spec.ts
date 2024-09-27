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
import { expect } from 'chai';
import { Severity, severityComparator } from '../severity';

describe('Severity-related functions', () => {
  describe('severityComparator', () => {
    it('orders severities', () => {
      // The default sort algorithm will compare every element against
      // some other when the input is in reverse order, ensuring 100%
      // coverage of the severityToNumber() function
      const severities: Severity[] = ['error', 'info', 'warn', 'ok'];
      const expected = ['ok', 'info', 'warn', 'error'];
      const actual = [...severities].sort(severityComparator);

      expect(actual, 'severities out of order').to.deep.equal(expected);
    });

    it('max computes the greatest severity', () => {
      const severities = ['ok', 'info', 'warn', 'info', 'warn', 'ok'];
      const actual = severities.reduce(severityComparator.max, 'ok');

      expect(actual, 'wrong maximum found').to.equal('warn');
    });
  });
});
