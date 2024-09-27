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
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';

import {
  CanExecutePredicate,
  ModelPatchFunction,
  ModelUpdater,
  MultiPatchCommand,
  PatchCommand,
  createModelPatchCommand,
  createModelUpdaterCommand,
  createModelUpdaterCommandWithResult,
} from '../patch-command';

import { fail } from 'assert';
import chaiLike from 'chai-like';
import { Operation } from 'fast-json-patch';
import cloneDeep from 'lodash/cloneDeep';
import { groupByModelId } from '../../core';

chai.use(chaiLike);
chai.use(chaiAsPromised);
chai.use(sinonChai);

describe('PatchCommand', () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('Simple execute/undo/redo', async () => {
    const patch: Operation[] = [
      {
        op: 'replace',
        path: '/id',
        value: 'updated-test-id',
      } as Operation,
    ];

    const document = cloneDeep(testDocument);
    const expectedDocument = cloneDeep(testDocument);
    expectedDocument.id = 'updated-test-id';

    const command = new PatchCommand('Test Command', 'document', patch);

    // Execute
    await expect(command.canExecute(document)).to.eventually.be.true;
    const executeResult = await command.execute(document);

    expect(document).to.deep.equal(expectedDocument);
    expect(executeResult).to.not.be.undefined;

    if (executeResult) {
      // Should contain a single 'replace' operation (and maybe some optional 'test' operations)
      const operations = executeResult.filter(
        (operation) => operation.op !== 'test'
      );
      expect(operations).to.be.an('array').of.length(1);
      expect(operations[0].op).to.equal('replace');
    }

    // Undo
    expect(command.canUndo(document)).to.be.true;
    command.undo(document);

    expect(document).to.deep.equal(testDocument);

    // Redo

    expect(command.canRedo(document)).to.be.true;
    command.redo(document);

    expect(document).to.deep.equal(expectedDocument);
  });

  it('Invalid patch', async () => {
    const invalidPatch: Operation[] = [
      {
        op: 'remove',
        path: '/wrong-id',
      },
    ];

    const document = cloneDeep(testDocument);
    const expectedDocument = cloneDeep(testDocument);

    const invalidCommand = new PatchCommand(
      'Test Command',
      'document',
      invalidPatch
    );

    // Currently, we don't validate commands, so canExecute is always true
    await expect(invalidCommand.canExecute(document)).to.eventually.be.true;

    const executeResult = await invalidCommand.execute(document);

    expect(document).to.deep.equal(expectedDocument);
    expect(executeResult).to.not.be.undefined;
    expect(executeResult).to.be.an('array').empty;
  });

  it('Command lifecycle', async () => {
    const patch: Operation[] = [
      {
        op: 'replace',
        path: '/id',
        value: 'updated-test-id',
      } as Operation,
    ];

    const document = cloneDeep(testDocument);
    const command = new PatchCommand('Test Command', 'document', patch);

    await expect(command.canExecute(document)).to.eventually.be.true;
    expect(command.canUndo(document)).to.be.false;
    expect(command.canRedo(document)).to.be.false;

    await command.execute(document);

    await expect(command.canExecute(document)).to.eventually.be.false;
    expect(command.canUndo(document)).to.be.true;
    expect(command.canRedo(document)).to.be.false;

    command.undo(document);

    await expect(command.canExecute(document)).to.eventually.be.false;
    expect(command.canUndo(document)).to.be.false;
    expect(command.canRedo(document)).to.be.true;

    command.redo(document);

    await expect(command.canExecute(document)).to.eventually.be.false;
    expect(command.canUndo(document)).to.be.true;
    expect(command.canRedo(document)).to.be.false;
  });

  it('Command lifecycle (Invalid)', async () => {
    const patch: Operation[] = [
      {
        op: 'replace',
        path: '/id',
        value: 'updated-test-id',
      } as Operation,
    ];

    const document = cloneDeep(testDocument);
    const command = new PatchCommand('Test Command', 'document', patch);

    // Undo command before it is executed: throws an error
    let success = false;
    try {
      command.undo(document);
      success = true;
    } catch (error) {
      // Okay
    }
    if (success) {
      fail('Command should not be undoable');
    }

    // Redo command before it is executed: throws an error
    success = false;
    try {
      command.redo(document);
      success = true;
    } catch (error) {
      // Okay
    }
    if (success) {
      fail('Command should not be redoable');
    }

    await command.execute(document);

    // Execute command twice: throws an error
    success = false;
    try {
      await command.execute(document);
      success = true;
    } catch (error) {
      // Okay
    }
    if (success) {
      fail('Command should not be executable');
    }

    // Redo command before it is undone: throws an error
    success = false;
    try {
      command.redo(document);
      success = true;
    } catch (error) {
      // Okay
    }
    if (success) {
      fail('Command should not be redoable');
    }

    command.undo(document);

    // Execute command twice: throws an error (even after undo)
    success = false;
    try {
      await command.execute(document);
      success = true;
    } catch (error) {
      // Okay
    }
    if (success) {
      fail('Command should not be executable');
    }

    // Undo command twice: throws an error
    success = false;
    try {
      command.undo(document);
      success = true;
    } catch (error) {
      // Okay
    }
    if (success) {
      fail('Command should not be undoable');
    }
  });

  describe('MultiPatchCommand', () => {
    it('1 Sub command', async () => {
      const patch: Operation[] = [
        {
          op: 'replace',
          path: '/id',
          value: 'updated-test-id',
        } as Operation,
      ];

      const document = cloneDeep(testDocument);
      const expectedDocument = cloneDeep(testDocument);
      expectedDocument.id = 'updated-test-id';

      const command = new MultiPatchCommand('Test Multi Command', {
        modelId: 'test',
        patch,
      });

      const getModel = (modelId: string) =>
        modelId == 'test' ? document : undefined;

      // Execute
      await expect(command.canExecute(getModel)).to.eventually.be.true;
      const executeResult = await command.execute(getModel);

      expect(document).to.deep.equal(expectedDocument);
      expect(executeResult).to.not.be.undefined;

      if (executeResult) {
        const modelToPatch = groupByModelId(executeResult);

        expect(modelToPatch.size).to.equal(1);

        const resultPatch = modelToPatch.get('test');
        expect(resultPatch).to.not.be.undefined;

        if (resultPatch !== undefined) {
          const operations = resultPatch.filter(
            (operation) => operation.op !== 'test'
          );
          // Should contain a single 'replace' operation (and maybe some optional 'test' operations)
          expect(operations).to.be.an('array').of.length(1);
          expect(operations[0].op).to.equal('replace');
        }
      }

      // Undo
      await expect(command.canUndo(getModel)).to.eventually.be.true;
      await command.undo(getModel);

      expect(document).to.deep.equal(testDocument);

      // Redo
      await expect(command.canRedo(getModel)).to.eventually.be.true;
      await command.redo(getModel);

      expect(document).to.deep.equal(expectedDocument);
    });

    it('2 Sub commands', async () => {
      const patch1: Operation[] = [
        {
          op: 'replace',
          path: '/id',
          value: 'updated-test-id',
        } as Operation,
      ];

      const patch2: Operation[] = [
        {
          op: 'add',
          path: '/children/-',
          value: {
            type: 'child-node',
            value: 890,
            valid: false,
          },
        } as Operation,
      ];

      const document1 = cloneDeep(testDocument);
      const document2 = cloneDeep(secondTestDocument);

      const expectedDocument1 = cloneDeep(testDocument);
      expectedDocument1.id = 'updated-test-id';

      const expectedDocument2 = cloneDeep(secondTestDocument);
      expectedDocument2.children.push({
        type: 'child-node',
        value: 890,
        valid: false,
      });

      const command = new MultiPatchCommand(
        'Test Multi Command',
        {
          modelId: 'document1',
          patch: patch1,
        },
        {
          modelId: 'document2',
          patch: patch2,
        }
      );

      const getModel = (modelId: string) => {
        switch (modelId) {
          case 'document1':
            return document1;
          case 'document2':
            return document2;
          default:
            return undefined;
        }
      };

      // Execute
      // PatchCommand is synchronous, so MultiPatchCommand is, too
      await expect(command.canExecute(getModel)).to.eventually.be.true;
      const executeResult = await command.execute(getModel);

      expect(document1).to.deep.equal(expectedDocument1);
      expect(document2).to.deep.equal(expectedDocument2);
      expect(executeResult).to.not.be.undefined;

      if (executeResult) {
        const modelToPatch = groupByModelId(executeResult);

        expect(modelToPatch.size).to.equal(2);

        const resultPatch1 = modelToPatch.get('document1');
        expect(resultPatch1).to.not.be.undefined;

        if (resultPatch1 !== undefined) {
          const operations = resultPatch1.filter(
            (operation) => operation.op !== 'test'
          );
          // Should contain a single 'replace' operation (and maybe some optional 'test' operations)
          expect(operations).to.be.an('array').of.length(1);
          expect(operations[0].op).to.equal('replace');
        }

        const resultPatch2 = modelToPatch.get('document2');
        expect(resultPatch2).to.not.be.undefined;

        if (resultPatch2 !== undefined) {
          const operations = resultPatch2.filter(
            (operation) => operation.op !== 'test'
          );
          // Should contain a single 'replace' operation (and maybe some optional 'test' operations)
          expect(operations).to.be.an('array').of.length(1);
          expect(operations[0].op).to.equal('add');
        }
      }

      // Undo
      await expect(command.canUndo(getModel)).to.eventually.be.true;
      await command.undo(getModel);

      expect(document1).to.deep.equal(testDocument);
      expect(document2).to.deep.equal(secondTestDocument);

      // Redo
      await expect(command.canRedo(getModel)).to.eventually.be.true;
      await command.redo(getModel);

      expect(document1).to.deep.equal(expectedDocument1);
      expect(document2).to.deep.equal(expectedDocument2);
    });

    it('2 Sub commands - 1 model', async () => {
      const patch1: Operation[] = [
        {
          op: 'replace',
          path: '/id',
          value: 'updated-test-id',
        } as Operation,
      ];

      const patch2: Operation[] = [
        {
          op: 'add',
          path: '/children/-',
          value: {
            type: 'child-node',
            value: 90,
            valid: true,
          },
        } as Operation,
      ];

      const document = cloneDeep(testDocument);
      const expectedDocument = cloneDeep(testDocument);
      expectedDocument.id = 'updated-test-id';
      expectedDocument.children.push({
        type: 'child-node',
        value: 90,
        valid: true,
      });

      const command = new MultiPatchCommand(
        'Test Multi Command',
        {
          modelId: 'document',
          patch: patch1,
        },
        {
          modelId: 'document',
          patch: patch2,
        }
      );

      const getModel = (modelId: string) =>
        modelId === 'document' ? document : undefined;

      // Execute
      await expect(command.canExecute(getModel)).to.eventually.be.true;
      const executeResult = await command.execute(getModel);

      expect(document).to.deep.equal(expectedDocument);
      expect(executeResult).to.not.be.undefined;

      if (executeResult) {
        const modelToPatch = groupByModelId(executeResult);

        expect(modelToPatch.size).to.equal(1);

        const resultPatch = modelToPatch.get('document');
        expect(resultPatch).to.not.be.undefined;

        if (resultPatch !== undefined) {
          const operations = resultPatch.filter(
            (operation) => operation.op !== 'test'
          );
          // Should contain one 'replace' operation and one 'add' operation
          // (and maybe some optional 'test' operations)
          expect(operations).to.be.an('array').of.length(2);
          expect(operations[0].op).to.equal('replace');
          expect(operations[1].op).to.equal('add');
        }
      }

      // Undo
      await expect(command.canUndo(getModel)).to.eventually.be.true;
      await command.undo(getModel);

      expect(document).to.deep.equal(testDocument);

      // Redo
      await expect(command.canRedo(getModel)).to.eventually.be.true;
      await command.redo(getModel);

      expect(document).to.deep.equal(expectedDocument);
    });
  });

  describe('createModelUpdaterCommand', () => {
    it('Simple execute/undo/redo', async () => {
      const updater: ModelUpdater<string, typeof testDocument> = (
        workingCopy,
        modelId
      ) => {
        expect(modelId).to.be.equal('document');
        workingCopy.id = 'updated-test-id';
      };

      const document = cloneDeep(testDocument);
      const expectedDocument = cloneDeep(testDocument);
      expectedDocument.id = 'updated-test-id';

      const command = createModelUpdaterCommand(
        'Test Command',
        'document',
        updater
      );

      // Execute
      await expect(command.canExecute(document)).to.eventually.be.true;
      const executeResult = await command.execute(document);

      expect(document).to.deep.equal(expectedDocument);
      expect(executeResult).to.not.be.undefined;

      if (executeResult) {
        // Should contain a single 'replace' operation (and maybe some optional 'test' operations)
        const operations = executeResult.filter(
          (operation) => operation.op !== 'test'
        );
        expect(operations).to.be.an('array').of.length(1);
        expect(operations[0].op).to.equal('replace');
      }

      // Undo
      expect(command.canUndo(document)).to.be.true;
      command.undo(document);

      expect(document).to.deep.equal(testDocument);

      // Redo

      expect(command.canRedo(document)).to.be.true;
      command.redo(document);

      expect(document).to.deep.equal(expectedDocument);
    });

    it('Execute/undo/redo when modifying attribute to undefined', async () => {
      const updater: ModelUpdater<
        string,
        RecursiveTestDocumentWithUndefined
      > = (workingCopy, modelId) => {
        expect(modelId).to.be.equal('document');
        workingCopy.label = undefined;
        if (workingCopy.children[0]) {
          workingCopy.children[0].value = undefined;
        }
      };

      const document = cloneDeep(testDocument);
      const expectedDocument = (() => {
        const expectedDocument: RecursiveTestDocumentWithUndefined =
          cloneDeep(testDocument);
        expectedDocument.label = undefined;
        if (expectedDocument.children[0]) {
          expectedDocument.children[0].value = undefined;
        }
        return JSON.parse(JSON.stringify(expectedDocument));
      })();

      const command = createModelUpdaterCommand(
        'Test Command setting undefined attributes',
        'document',
        updater
      );

      // Execute
      await expect(command.canExecute(document)).to.eventually.be.true;
      const executeResult = await command.execute(document);

      expect(document).to.deep.equal(expectedDocument);
      expect(executeResult).to.not.be.undefined;

      if (executeResult) {
        // Should contain two 'remove' operations (and maybe some optional 'test' operations)
        const operations = executeResult.filter(
          (operation) => operation.op !== 'test'
        );
        expect(operations).to.be.an('array').of.length(2);
        expect(operations[0].op).to.equal('remove');
        expect(operations[1].op).to.equal('remove');
      }

      // Undo
      expect(command.canUndo(document)).to.be.true;
      command.undo(document);

      expect(document).to.deep.equal(testDocument);

      // Redo
      expect(command.canRedo(document)).to.be.true;
      command.redo(document);

      expect(document).to.deep.equal(expectedDocument);
    });

    it('Execute/undo/redo when adding undefined value in array', async () => {
      const updater: ModelUpdater<
        string,
        RecursiveTestDocumentWithUndefined
      > = (workingCopy, modelId) => {
        expect(modelId).to.be.equal('document');
        workingCopy.children.push(undefined);
      };

      const document = cloneDeep(testDocument);
      const expectedDocument = (() => {
        const expectedDocument: RecursiveTestDocumentWithUndefined =
          cloneDeep(testDocument);
        expectedDocument.children.push(undefined);
        return JSON.parse(JSON.stringify(expectedDocument));
      })();

      const command = createModelUpdaterCommand(
        'Test Command adding an undefined value in array',
        'document',
        updater
      );

      // Execute
      await expect(command.canExecute(document)).to.eventually.be.true;
      const executeResult = await command.execute(document);

      expect(document).to.deep.equal(expectedDocument);
      expect(executeResult).to.not.be.undefined;

      if (executeResult) {
        // Should contain one 'add' operations (and maybe some optional 'test' operations)
        const operations = executeResult.filter(
          (operation) => operation.op !== 'test'
        );
        expect(operations).to.be.an('array').of.length(1);
        expect(operations[0].op).to.equal('add');
      }

      // Undo
      expect(command.canUndo(document)).to.be.true;
      command.undo(document);

      expect(document).to.deep.equal(testDocument);

      // Redo
      expect(command.canRedo(document)).to.be.true;
      command.redo(document);

      expect(document).to.deep.equal(expectedDocument);
    });

    it('Execute/undo/redo when modifying model to be recursive', async () => {
      const updater: ModelUpdater<
        string,
        RecursiveTestDocumentWithUndefined
      > = (workingCopy, modelId) => {
        expect(modelId).to.be.equal('document');
        workingCopy.children.push(workingCopy);
      };

      const document = cloneDeep(testDocument);

      const command = createModelUpdaterCommand(
        'Test Command adding an undefined value in array',
        'document',
        updater
      );

      await expect(command.canExecute(document)).to.eventually.be.true;
      try {
        await command.execute(document);
      } catch (e) {
        // success
        return;
      }
      fail('execution should not be possible as the model is recursive');
    });

    it('Execute/undo/redo when modifying model to contain doubly linked references', async () => {
      const updater: ModelUpdater<
        string,
        RecursiveTestDocumentWithUndefined
      > = (workingCopy, modelId) => {
        expect(modelId).to.be.equal('document');
        if (workingCopy.children[0] && workingCopy.children[1]) {
          workingCopy.children[0].link = workingCopy.children[1];
          workingCopy.children[1].link = workingCopy.children[0];
        } else {
          fail('Unexpected test document');
        }
      };

      const document = cloneDeep(testDocument);

      const command = createModelUpdaterCommand(
        'Test Command adding an undefined value in array',
        'document',
        updater
      );

      await expect(command.canExecute(document)).to.eventually.be.true;
      try {
        await command.execute(document);
      } catch (e) {
        // success
        return;
      }
      fail('execution should not be possible as the model is doubly linked');
    });

    it('Execute/undo/redo empty change', async () => {
      const updater: ModelUpdater<string, typeof testDocument> = (
        workingCopy,
        modelId
      ) => {
        expect(modelId).to.be.equal('document');
        expect(workingCopy).to.be.equal(document);
        // Don't make any change. That's the point
      };

      const document = cloneDeep(testDocument);
      const expectedDocument = cloneDeep(testDocument);

      const command = createModelUpdaterCommand(
        'Empty Command',
        'document',
        updater
      );

      // Execute
      await expect(command.canExecute(document)).to.eventually.be.true;
      const executeResult = await command.execute(document);

      expect(document).to.deep.equal(expectedDocument);
      expect(executeResult).to.not.be.undefined;

      if (executeResult) {
        // Should contain a single 'replace' operation (and maybe some optional 'test' operations)
        const operations = executeResult.filter(
          (operation) => operation.op !== 'test'
        );
        expect(operations).to.be.an('array').of.length(0);
      }

      // Undo
      expect(command.canUndo(document)).to.be.true;
      command.undo(document);

      expect(document).to.deep.equal(testDocument);

      // Redo

      expect(command.canRedo(document)).to.be.true;
      command.redo(document);

      expect(document).to.deep.equal(expectedDocument);
    });

    describe('Options', () => {
      it('Non-executable', async () => {
        const updater: ModelUpdater<string, typeof testDocument> = (
          model,
          modelId
        ) => {
          expect(model).to.be.equal(document);
          expect(modelId).to.be.equal('document');
        };

        const canExecute: CanExecutePredicate<string, typeof testDocument> = (
          model,
          modelId
        ) => {
          expect(model).to.be.equal(document);
          expect(modelId).to.be.equal('document');
          return Promise.resolve('test reason');
        };

        const document = cloneDeep(testDocument);

        const command = createModelUpdaterCommand(
          'Test Command',
          'document',
          updater,
          { canExecute }
        );

        await expect(command.canExecute(document)).to.eventually.be.false;
        await expect(command.execute(document)).to.eventually.be.rejectedWith(
          /PatchCommand.*cannot be executed: test reason/
        );
      });

      it('Strict undo predicate', async () => {
        const document = cloneDeep(testDocument);

        const updater: ModelUpdater<string, typeof testDocument> = (
          workingCopy
        ) => {
          workingCopy.id = 'updated-id';
        };

        const command = createModelUpdaterCommand(
          'Undo Preconditions',
          'document',
          updater
          // Default mode is 'strict', so test that, too
        );
        await command.execute(document);

        // Simulate an interfering change as from a trigger
        document.id = 'broken';
        let thrown: unknown;

        try {
          await command.undo(document);
        } catch (error) {
          thrown = error;
        }

        expect(thrown)
          .to.be.an('Error')
          .with.property('message')
          .contains('Test operation failed');
      });

      it('Lax undo predicate', async () => {
        const debug = sandbox.stub(console, 'debug');
        const document = cloneDeep(testDocument);

        const updater: ModelUpdater<string, typeof testDocument> = (
          workingCopy
        ) => {
          workingCopy.id = 'updated-id';
        };

        const command = createModelUpdaterCommand(
          'Undo Preconditions',
          'document',
          updater,
          { preconditionsMode: 'lax' }
        );
        await command.execute(document);

        // Simulate an interfering change as from a trigger
        document.id = 'broken';

        await command.undo(document);
        expect(debug).to.have.been.calledWithMatch(
          'Inapplicable undo/redo patch.',
          Error
        );
      });
    });

    it('With Result', async () => {
      type Result = {
        ok: boolean;
        message: string;
      };

      const updaterWithResult: ModelUpdater<
        string,
        typeof testDocument,
        Result
      > = (workingCopy, modelId) => {
        expect(modelId).to.be.equal('document');
        workingCopy.id = 'updated-test-id';

        return { ok: true, message: 'Hello, world.' };
      };

      const document = cloneDeep(testDocument);
      const expectedDocument = cloneDeep(testDocument);
      expectedDocument.id = 'updated-test-id';

      const command = createModelUpdaterCommandWithResult(
        'Test Command',
        'document',
        updaterWithResult
      );

      expect(command.result).not.to.exist;

      // Execute
      await expect(command.canExecute(document)).to.eventually.be.true;
      await command.execute(document);

      expect(command.result).to.exist;
      expect(command.result).to.be.like({ ok: true, message: 'Hello, world.' });
    });
  });

  describe('createModelPatchCommand', () => {
    it('Simple execute/undo/redo', async () => {
      const patchFunction: ModelPatchFunction<string, typeof testDocument> = (
        workingCopy,
        modelId
      ) => {
        expect(modelId).to.be.equal('document');
        expect(workingCopy).to.be.equal(document);
        return [
          {
            op: 'replace',
            path: '/id',
            value: 'updated-test-id',
          },
        ] as Operation[];
      };

      const document = cloneDeep(testDocument);
      const expectedDocument = cloneDeep(testDocument);
      expectedDocument.id = 'updated-test-id';

      const command = createModelPatchCommand(
        'Test Command',
        'document',
        patchFunction
      );

      // Execute
      await expect(command.canExecute(document)).to.eventually.be.true;
      const executeResult = await command.execute(document);

      expect(document).to.deep.equal(expectedDocument);
      expect(executeResult).to.not.be.undefined;

      if (executeResult) {
        // Should contain a single 'replace' operation (and maybe some optional 'test' operations)
        const operations = executeResult.filter(
          (operation) => operation.op !== 'test'
        );
        expect(operations).to.be.an('array').of.length(1);
        expect(operations[0].op).to.equal('replace');
      }

      // Undo
      expect(command.canUndo(document)).to.be.true;
      command.undo(document);

      expect(document).to.deep.equal(testDocument);

      // Redo

      expect(command.canRedo(document)).to.be.true;
      command.redo(document);

      expect(document).to.deep.equal(expectedDocument);
    });
  });
});

const testDocument = {
  id: 'test-id',
  label: 'Test Document',
  children: [
    {
      type: 'child-node',
      value: 13,
      valid: true,
    },
    {
      type: 'child-node',
      value: 175,
      valid: false,
    },
    {
      type: 'child-node',
      value: 1,
      valid: true,
    },
  ],
};

const secondTestDocument = {
  id: 'second-test-id',
  label: 'Second Test Document',
  children: [
    {
      type: 'child-node',
      value: 130,
      valid: true,
    },
    {
      type: 'child-node',
      value: 775,
      valid: false,
    },
  ],
};

/**
 * Used to test invalid modifications
 */
interface RecursiveTestDocumentWithUndefined {
  id: string;
  label?: string;
  value?: number;
  link?: RecursiveTestDocumentWithUndefined['children'];
  children: Array<
    | {
        type: string;
        value?: number;
        valid: boolean;
        link?: RecursiveTestDocumentWithUndefined['children'][0];
      }
    | undefined
    | RecursiveTestDocumentWithUndefined
  >;
}
