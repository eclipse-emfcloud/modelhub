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

import { Operation } from 'fast-json-patch';
import {
  addOperations,
  addOrReplaceOperations,
  nonTestOperations,
  removeOperations,
} from '../trigger';

const allOperations: Operation[] = [
  { op: 'test', path: '/int', value: 42 },
  { op: 'add', path: '/int', value: 42 },
  { op: 'replace', path: '/int', value: 42 },
  { op: 'remove', path: '/int' },
  { op: 'copy', path: '/int', from: '/over/there' },
  { op: 'test', path: '/string', value: '29' },
  { op: 'move', path: '/string', from: '/over/there' },
  { op: 'add', path: '/string', value: '29' },
  { op: 'replace', path: '/string', value: '29' },
  { op: 'remove', path: '/string' },
];

describe('Helper Functions for Triggers', () => {
  it('nonTestOperations', () => {
    const nonTest = nonTestOperations(allOperations);
    expect(nonTest).to.be.deep.equal([
      { op: 'add', path: '/int', value: 42 },
      { op: 'replace', path: '/int', value: 42 },
      { op: 'remove', path: '/int' },
      { op: 'copy', path: '/int', from: '/over/there' },
      { op: 'move', path: '/string', from: '/over/there' },
      { op: 'add', path: '/string', value: '29' },
      { op: 'replace', path: '/string', value: '29' },
      { op: 'remove', path: '/string' },
    ]);
  });

  it('addOperations', () => {
    const add = addOperations(allOperations);
    expect(add).to.be.deep.equal([
      { op: 'add', path: '/int', value: 42 },
      { op: 'add', path: '/string', value: '29' },
    ]);
  });

  it('addOperations with value guard', () => {
    const add = addOperations(allOperations, isInt);
    expect(add).to.be.deep.equal([{ op: 'add', path: '/int', value: 42 }]);
  });

  it('addOrReplaceOperations', () => {
    const addOrReplace = addOrReplaceOperations(allOperations);
    expect(addOrReplace).to.be.deep.equal([
      { op: 'add', path: '/int', value: 42 },
      { op: 'replace', path: '/int', value: 42 },
      { op: 'add', path: '/string', value: '29' },
      { op: 'replace', path: '/string', value: '29' },
    ]);
  });

  it('addOrReplaceOperations with value guard', () => {
    const addOrReplace = addOrReplaceOperations(allOperations, isString);
    expect(addOrReplace).to.be.deep.equal([
      { op: 'add', path: '/string', value: '29' },
      { op: 'replace', path: '/string', value: '29' },
    ]);
  });

  it('removeOperations', () => {
    const remove = removeOperations(allOperations);
    expect(remove).to.be.deep.equal([
      { op: 'remove', path: '/int' },
      { op: 'remove', path: '/string' },
    ]);
  });
});

function isInt(value: unknown): value is number {
  return typeof value === 'number';
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
