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
import chaiLike from 'chai-like';
import chaiThings from 'chai-things';
import { ModelTriggerEngine } from '../model-trigger-engine';

import {
  addOperations,
  addOrReplaceOperations,
} from '@eclipse-emfcloud/trigger-engine';
import { Operation, applyPatch, compare } from 'fast-json-patch';
import { cloneDeep } from 'lodash';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import { ModelTrigger } from '../../api/model-trigger';

chai.use(chaiLike);
chai.use(chaiThings);
chai.use(sinonChai);

type Priority = 'high' | 'medium' | 'low';

const originalModelImage = {
  name: 'The Model',
  tasks: [{ label: 'a', priority: 'medium' }],
  mediumPrioTasks: 1,
};

type Model = typeof originalModelImage;

const MODEL_ID = 'example://38BCC304-652F-4C27-A225-81BF6C8EDCA8/model';

/** A trigger that initializes the priority of a newly added task. */
const priorityOfNewTask: ModelTrigger<string, Model> = {
  getPatch: async (modelId, model, delta) => {
    const op = addOperations(delta)[0];
    if (modelId !== MODEL_ID || !op) {
      return undefined;
    }
    const match = /\/tasks\/(-|\d+)/.exec(op.path);
    if (!match) {
      return undefined;
    }
    const taskIndex = match[1] === '-' ? -1 : Number(match[1]);
    return setPriority(model, taskIndex, 'medium');
  },
};

/** A trigger recounts the medium priority tasks when a task's priority is changed. */
const recountMediumPrioTasks: ModelTrigger<string, Model> = {
  getPatch: (modelId, model, delta) => {
    const op = addOrReplaceOperations(delta)[0];
    if (op && modelId == MODEL_ID && /\/tasks\/\d+\/priority/.test(op.path)) {
      return updateMediumPrioTasks(model);
    }
    return undefined;
  },
};

describe('ModelTriggerEngine', () => {
  let engine: ModelTriggerEngine<string>;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    engine = new ModelTriggerEngine<string>();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('applyModelTriggers', () => {
    it('no triggers present', async () => {
      const patch = await runTriggers(engine, addTask('b'));
      expect(patch).not.to.exist;
    });

    it('trigger present', async () => {
      engine.addModelTrigger(priorityOfNewTask);

      const patch = await runTriggers(engine, addTask('b'));
      expect(patch).to.contain.something.like({
        op: 'add',
        path: '/tasks/1/priority',
        value: 'medium',
      });
    });

    describe('cascading triggers present', () => {
      const permutations = [
        [priorityOfNewTask, recountMediumPrioTasks],
        [recountMediumPrioTasks, priorityOfNewTask],
      ];

      permutations.forEach((permutation, index) => {
        it(`permutation ${index}`, async () => {
          permutation.forEach((trigger) => engine.addModelTrigger(trigger));

          const patch = await runTriggers(engine, addTask('b'));
          expect(patch).to.contain.something.like({
            op: 'replace',
            path: '/mediumPrioTasks',
            value: 2,
          });
          // Of course, it also still sets the priority of the new task, also
          expect(patch).to.contain.something.like({
            op: 'add',
            path: '/tasks/1/priority',
            value: 'medium',
          });
        });
      });

      it('correct interim model states provided', async () => {
        const spyOnPriorityOfNewTask = sandbox.spy(
          priorityOfNewTask,
          'getPatch'
        );
        engine.addModelTrigger(priorityOfNewTask);

        const initialModelState = cloneDeep(originalModelImage);
        const secondModelState = cloneDeep(initialModelState);
        secondModelState.tasks.push({
          label: 'b',
        } as unknown as Model['tasks'][number]);
        const finalModelState = cloneDeep(secondModelState);
        finalModelState.tasks[1].priority = 'medium';

        await runTriggers(engine, addTask('b'));

        expect(spyOnPriorityOfNewTask).to.have.been.calledTwice;
        expect(spyOnPriorityOfNewTask).to.have.been.calledWithMatch(
          MODEL_ID,
          sinon.match.any,
          sinon.match.any,
          initialModelState
        );
        expect(spyOnPriorityOfNewTask).to.have.been.calledWithMatch(
          MODEL_ID,
          finalModelState,
          sinon.match.any,
          secondModelState
        );
      });
    });

    describe('edge cases', () => {
      it('apply empty patch', async () => {
        engine.addModelTrigger(priorityOfNewTask);

        const patch = await runTriggers(engine, []);
        expect(patch).not.to.exist;
      });
    });
  });
});

async function runTriggers(
  engine: ModelTriggerEngine,
  patch: Operation[]
): Promise<Operation[] | undefined> {
  return engine.applyModelTriggers(MODEL_ID, ...modifyModel(patch));
}

function modifyModel(
  patch: Operation[]
): [model: Model, delta: Operation[], previousModel: Model] {
  const previousModel = cloneDeep(originalModelImage);
  // This creates a copy, not modifying the `previousDocument`
  const model = applyPatch(previousModel, patch, false, false).newDocument;
  // Calculate a diff to ensure that we don't have '/-' segments for array appends
  const delta = compare(previousModel, model, true);
  return [model, delta, previousModel];
}

function addTask(label: string): Operation[] {
  return [{ op: 'add', path: '/tasks/-', value: { label } }];
}

function setPriority(
  model: Model,
  taskOffset: number,
  priority: Priority
): Operation[] | undefined {
  const taskIndex =
    taskOffset >= 0 ? taskOffset : model.tasks.length + taskOffset;
  const task = model.tasks[taskIndex];
  if (task.priority !== priority) {
    return [
      {
        op: task.priority ? 'replace' : 'add',
        path: `/tasks/${taskIndex}/priority`,
        value: priority,
      },
    ];
  }
  return undefined;
}

function updateMediumPrioTasks(model: Model): Operation[] | undefined {
  const oldValue = model.mediumPrioTasks;
  const newValue = model.tasks.reduce(
    (count, task) => (task.priority !== 'medium' ? count : count + 1),
    0
  );

  if (newValue != oldValue) {
    return [{ op: 'replace', path: '/mediumPrioTasks', value: newValue }];
  }
  return undefined;
}
