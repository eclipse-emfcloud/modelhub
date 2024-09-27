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
import { Diagnostic, merge, ok } from '../diagnostic';

describe('Diagnostic functions', () => {
  describe('ok', () => {
    it('yields an OK diagnostic', () => {
      const actual = ok();

      expect(actual.severity, 'not ok').to.be.equal('ok');
      expect(actual.source).to.be.equal('@eclipse-emfcloud/model-validation');
    });

    it('always yields a new instance', () => {
      const first = ok();
      const second = ok();

      expect(second, 'not distinct').not.to.be.equal(first);
    });

    it('supports a custom source', () => {
      const custom = ok('@example/test');

      expect(custom.source, 'stock source').to.be.equal('@example/test');
    });
  });

  describe('merge', () => {
    const defaultOKInstance = ok();
    const customOKInstance: Diagnostic = {
      severity: 'ok',
      source: '@example/test',
      code: '0',
      path: '',
      message: 'Hello.',
    };
    const infoInstance: Diagnostic = {
      severity: 'info',
      source: '@example/test',
      code: '1',
      path: 'foo/infoProp',
      message: 'I have information for you.',
    };
    const warningInstance: Diagnostic = {
      severity: 'warn',
      source: '@example/test',
      code: '2',
      path: 'foo/warningProp',
      message: 'This is a warning.',
    };
    const errorInstance: Diagnostic = {
      severity: 'error',
      source: '@example/test',
      code: '4',
      path: 'foo/errorProp',
      message: 'Error, error!',
      children: [], // Empty children array is equivalent to absent children array
    };
    const multiWarningInstance: Diagnostic = {
      severity: 'warn',
      source: '@example/test',
      path: 'foo/warningObject',
      message: '',
      children: [warningInstance, infoInstance],
    };
    const multiErrorInstance: Diagnostic = {
      severity: 'error',
      source: '@example/test',
      path: 'foo/errorObject',
      message: '',
      children: [customOKInstance, errorInstance],
    };

    // This one contains itself and is, therefore, invalid
    const cyclicInstance: Diagnostic = {
      severity: 'error',
      source: '@example/test',
      path: 'bar/cyclic',
      message: '',
      children: [multiWarningInstance],
    };
    cyclicInstance.children?.push(cyclicInstance);

    it('merges no diagnostics', () => {
      const actual = merge();

      expect(actual.severity, 'not ok').to.be.equal('ok');
      verifySerializable(actual);
    });

    it('merges one diagnostic', () => {
      const actual = merge(infoInstance);

      expect(actual, 'input not returned').to.be.equal(infoInstance);
      verifySerializable(actual);
    });

    it('merges only OK diagnostics', () => {
      const actual = merge(defaultOKInstance, customOKInstance);

      expect(actual.severity, 'not ok').to.be.equal('ok');
      expect(actual, 'returned one of the inputs')
        .not.to.equal(defaultOKInstance)
        .and.not.to.equal(customOKInstance);
      verifySerializable(actual);
    });

    it('merges an OK and a problem', () => {
      const actual = merge(customOKInstance, warningInstance);

      expect(actual).to.equal(warningInstance);
      verifySerializable(actual);
    });

    it('merges a leaf and another leaf', () => {
      const actual = merge(infoInstance, warningInstance);

      expect(actual).to.deep.equal({
        severity: 'warn',
        source: '@example/test',
        path: 'foo',
        message: '2 problems found.',
        children: [infoInstance, warningInstance],
      });
      verifySerializable(actual);
    });

    it('merges a leaf and a non-leaf', () => {
      const actual = merge(errorInstance, multiWarningInstance);

      expect(actual).to.deep.equal({
        severity: 'error',
        source: '@example/test',
        path: 'foo',
        message: '3 problems found.',
        children: [errorInstance, warningInstance, infoInstance],
      });
      verifySerializable(actual);
    });

    it('merges a leaf and a non-leaf in which some child is OK', () => {
      const actual = merge(warningInstance, multiErrorInstance);

      expect(actual).to.deep.equal({
        severity: 'error',
        source: '@example/test',
        path: 'foo',
        message: '2 problems found.',
        children: [warningInstance, errorInstance], // `customOKInstance` was elided
      });
      verifySerializable(actual);
    });

    it('merges a non-leaf and a leaf', () => {
      const actual = merge(multiWarningInstance, errorInstance);

      expect(actual).to.deep.equal({
        severity: 'error',
        source: '@example/test',
        path: 'foo',
        message: '3 problems found.',
        children: [warningInstance, infoInstance, errorInstance],
      });
      verifySerializable(actual);
    });

    it('merges a non-leaf in which some child is OK and a leaf', () => {
      const actual = merge(multiErrorInstance, warningInstance);

      expect(actual).to.deep.equal({
        severity: 'error',
        source: '@example/test',
        path: 'foo',
        message: '2 problems found.',
        children: [errorInstance, warningInstance], // `customOKInstance` was elided
      });
      verifySerializable(actual);
    });

    it('merges a non-leaf and another non-leaf', () => {
      const actual = merge(multiWarningInstance, multiErrorInstance);

      expect(actual).to.deep.equal({
        severity: 'error',
        source: '@example/test',
        path: 'foo',
        message: '3 problems found.',
        children: [warningInstance, infoInstance, errorInstance], // `customOKInstance` was elided
      });
      verifySerializable(actual);
    });

    it('tolerates a cyclic diagnostic', () => {
      const actual = merge(multiErrorInstance, cyclicInstance);

      expect(actual).to.include({
        severity: 'error',
        source: '@example/test',
        path: '',
        message: '3 problems found.',
      });
      expect(actual.children)
        .to.be.an('array')
        .of.length(3)
        .that.includes(errorInstance)
        .and.that.includes(multiWarningInstance)
        .and.that.includes(cyclicInstance);

      // Don't try to serialize this cyclic structure
    });

    it('merges more than two diagnostics', () => {
      const newInstance: Diagnostic = {
        severity: 'info',
        source: '@example/test',
        path: 'foo',
        message: "You've got mail!",
      };
      const actual = merge(
        infoInstance,
        warningInstance,
        multiErrorInstance,
        newInstance
      );

      expect(actual).to.deep.equal({
        severity: 'error',
        source: '@example/test',
        path: 'foo',
        message: '4 problems found.',
        children: [infoInstance, warningInstance, errorInstance, newInstance], // `customOKInstance` was elided
      });
      verifySerializable(actual);
    });

    it('merges non-leaf diagnostics that only have OK children', () => {
      const silly1: Diagnostic = {
        severity: 'info', // This doesn't make sense
        source: '@example/test',
        path: 'foo/silly/1',
        message: 'This is a silly diagnostic.',
        children: [defaultOKInstance, customOKInstance],
      };
      const silly2: Diagnostic = {
        severity: 'warn', // This doesn't make sense
        source: '@example/test',
        path: 'foo/silly/2',
        message: 'This is another silly diagnostic.',
        children: [ok(), defaultOKInstance],
      };
      const actual = merge(silly1, silly2);

      expect(actual, 'merge is not reduced').to.be.deep.equal(ok());
    });

    it('treats empty children array the same as no children array', () => {
      const emptyChildren: Diagnostic = {
        severity: 'warn',
        source: '@example/test',
        path: 'foo/emptyChildren',
        message: 'This diagnostic has an empty children array.',
        children: [],
      };
      const actual = merge(emptyChildren);

      expect(actual, 'leaf should have stood for itself').to.be.equal(
        emptyChildren
      );
    });

    it('merge of a single multi-diagnostic filters its children', () => {
      const actual = merge(multiErrorInstance);

      expect(actual, 'merge is not reduced').to.be.equal(errorInstance);
    });

    it('tolerates missing paths', () => {
      const missingPath = {
        severity: 'warn',
        source: '@example/test',
        message: 'None.',
      } as Diagnostic;
      const hasPath = {
        severity: 'info',
        source: '@example/test',
        path: 'foo/whatever',
        message: 'None.',
      } as Diagnostic;

      const missingFirst = merge(missingPath, hasPath);
      delete missingFirst.children;
      const missingSecond = merge(hasPath, missingPath);
      delete missingSecond.children;

      expect(missingSecond).to.be.deep.equal(missingFirst);
      expect(missingFirst).to.be.deep.equal({
        severity: 'warn',
        source: '@example/test',
        path: '',
        message: '2 problems found.',
      });
    });

    it('reduces mixed sources to nil', () => {
      const source1 = { source: '@example/1' } as Diagnostic;
      const source2a = { source: '@example/2' } as Diagnostic;
      const source2b = { source: '@example/2' } as Diagnostic;

      const actual = merge(source1, source2a, source2b);
      expect(actual.source).not.to.be.ok; // Chai's version of '.to.be.falsy'
    });

    it('source of empty merge is defaulted', () => {
      const actual = merge();
      expect(actual.source).to.be.equal('@eclipse-emfcloud/model-validation');
    });
  });
});

const verifySerializable = (d: Diagnostic): void => {
  const transmitted = JSON.parse(JSON.stringify(d));
  expect(transmitted).to.deep.equal(d);
};
