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
import chaiLike from 'chai-like';
import chaiThings from 'chai-things';
import { TriggerEngineImpl, TriggerEngineOptions } from '../trigger-engine';

import { AddOperation, Operation, applyPatch, compare } from 'fast-json-patch';
import { cloneDeep } from 'lodash';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import { Trigger, addOrReplaceOperations } from '../trigger';

chai.use(chaiLike);
chai.use(chaiThings);
chai.use(chaiAsPromised);
chai.use(sinonChai);

type Priority = 'high' | 'medium' | 'low';

type Task = {
  label: string;
  priority: Priority;
  tags?: string[];
};

type MyDocument = {
  name: string;
  tasks: Task[];
  mediumPrioTasks: number;
};

const originalDocument: MyDocument = {
  name: 'The Document',
  tasks: [{ label: 'a', priority: 'medium' }],
  mediumPrioTasks: 1,
};

describe('TriggerEngineImpl', () => {
  let engine: TriggerEngineImpl;
  let sandbox: sinon.SinonSandbox;

  const suite = (
    label: string,
    testOptions: TriggerEngineOptions | undefined,
    dependencies?: (this: Mocha.Suite) => void
  ) =>
    describe(label, () => {
      beforeEach(() => {
        sandbox = sinon.createSandbox();

        engine = testOptions
          ? new TriggerEngineImpl(testOptions)
          : new TriggerEngineImpl();
      });

      afterEach(() => {
        sandbox.restore();
      });

      describe('applyTriggers', () => {
        it('no triggers present', async () => {
          const result = await runTriggers(engine, addTask('b'));
          expect(result).not.to.exist;
        });

        it('trigger present', async () => {
          engine.addTrigger(priorityOfNewTask);

          const result = await runTriggers(engine, addTask('b'));
          expect(result).to.contain.something.like({
            op: 'add',
            path: '/tasks/1/priority',
            value: 'medium',
          });
        });

        it('cascading triggers present', async () => {
          engine.addTrigger(priorityOfNewTask);
          engine.addTrigger(recountMediumPrioTasks);

          const result = await runTriggers(engine, addTask('b'));
          expect(result).to.contain.something.like({
            op: 'replace',
            path: '/mediumPrioTasks',
            value: 2,
          });
          // Of course, it also still sets the priority of the new task, also
          expect(result).to.contain.something.like({
            op: 'add',
            path: '/tasks/1/priority',
            value: 'medium',
          });
        });

        it('subsequent iterations see delta from prior iteration', async () => {
          const snoopTrigger = snapshot(
            sandbox.stub<[MyDocument, Operation[], MyDocument]>()
          );

          engine.addTrigger(priorityOfNewTask);
          engine.addTrigger(snoopTrigger);

          await runTriggers(engine, addTask('b'));

          // Recall that the trigger will always be called at least twice, and we
          // need to verify the *second* call only
          const secondCall = snoopTrigger.snapshots[1];
          expect(secondCall[1]).to.be.an('array').of.length(1);
          expect(secondCall[1][0]).to.be.like({
            op: 'add',
            path: '/tasks/1/priority',
            value: 'medium',
          });
        });

        it('subsequent iterations see previous document states', async () => {
          const snoopTrigger = snapshot(
            sandbox.stub<[MyDocument, Operation[], MyDocument]>()
          );

          engine.addTrigger(priorityOfNewTask);
          engine.addTrigger(snoopTrigger);

          await runTriggers(engine, addTask('b'));

          // Recall that the trigger will always be called at least twice, and we
          // need to verify the *second* call only
          const secondCall = snoopTrigger.snapshots[1];
          expect(secondCall[2])
            .to.have.property('tasks')
            .that.is.an('array')
            .of.length(2);
          expect(secondCall[2].tasks[1]).to.be.like({
            label: 'b',
          });
          expect(secondCall[2].tasks[1]).not.to.have.property('priority');
        });

        it('subsequent iterations see changes only from previous iteration', async () => {
          engine.addTrigger(createAddTagsTrigger('a', 'b', 'c'));
          engine.addTrigger(createAddTaskIfTagAddedTrigger('a'));

          const result = await runTriggers(engine, addTask('added task'));

          expect(result).to.include.a.thing.like({
            op: 'add',
            path: '/tasks/1/tags',
            value: ['a'],
          });
          expect(result).to.include.a.thing.like({
            op: 'add',
            path: '/tasks/2',
            value: {
              label: "task for tag 'a'",
              tags: ['b'],
            },
          });

          // Tag 'c' wasn't added to anything
          expect(result).to.have.length(2);
          expect(result).not.to.include.a.thing.like({
            value: 'c',
          });
          expect(result).not.to.include.a.thing.like({
            value: ['c'],
          });
          expect(result).not.to.include.a.thing.like({
            value: { tags: ['c'] },
          });
        });

        it('triggers never see the original model', async () => {
          const trigger1 = sandbox.spy(priorityOfNewTask);
          const trigger2 = sandbox.spy(recountMediumPrioTasks);
          engine.addTrigger(trigger1);
          engine.addTrigger(trigger2);

          const [document, delta, previousDocument] = modifyDocument(
            addTask('b')
          );
          await engine.applyTriggers(document, delta, previousDocument);

          expect(trigger1).to.have.been.called;
          expect(trigger1).not.to.have.been.calledWith(document);
          expect(trigger2).to.have.been.called;
          expect(trigger2).not.to.have.been.calledWith(document);
        });
      });

      describe('safePatch mode', () => {
        it('protects against modifying patches', async () => {
          const triggeringPatch: Operation[] = [
            { op: 'add', path: '/tasks/-', value: { label: 'b' } },
          ];

          const providedPatch: Operation[] = [
            { op: 'add', path: '/tasks/1/nested', value: { nested: true } },
          ];
          const originalImage = cloneDeep(providedPatch);

          const dangerousTrigger: Trigger<MyDocument> = once(
            () => providedPatch
          );
          const innocentTrigger: Trigger<MyDocument> = (_doc, delta) => {
            const op = delta[0];
            if (op.op === 'add' && op.path === '/tasks/1/nested') {
              return [
                { op: 'add', path: '/tasks/1/nested/result', value: 'Boom!' },
              ];
            }
            return undefined;
          };

          engine = new TriggerEngineImpl({
            ...(testOptions ?? {}),
            safePatches: true,
          });

          engine.addTrigger(dangerousTrigger);
          engine.addTrigger(innocentTrigger);

          await runTriggers(engine, triggeringPatch);

          expect(providedPatch).to.deep.equal(originalImage);
        });
      });

      describe('iteration limit', () => {
        let triggeringPatch: Operation[];

        beforeEach(() => {
          triggeringPatch = [
            { op: 'add', path: '/tasks/-', value: { label: 'b' } },
          ];
        });

        it('enforces a plausible minimum', () => {
          expect(
            () =>
              new TriggerEngineImpl({
                ...(testOptions ?? {}),
                iterationLimit: 1,
              })
          ).to.throw('Iteration limit too low');
        });

        it('does not exceed the iteration limit', async () => {
          const trigger = repeatTrigger();
          engine.addTrigger(trigger);

          const providedPatch = await runTriggers(engine, triggeringPatch);
          expect(providedPatch)
            .to.be.an('array')
            .of.length.greaterThanOrEqual(trigger.iterationCount);
        });

        it('correct interim states of previous document', async () => {
          const trigger = repeatTrigger();
          engine.addTrigger(trigger);

          await runTriggers(engine, triggeringPatch);
          expect(trigger.interimStates.length).to.be.equal(
            trigger.iterationCount
          );
          for (let i = 0; i < trigger.iterationCount; i++) {
            expect(trigger.interimStates[i].tasks.length).to.be.equal(i + 1);
          }
        });

        it('exceeds the iteration limit', async () => {
          engine = new TriggerEngineImpl({
            ...(testOptions ?? {}),
            iterationLimit: 99,
          });
          const trigger = repeatTrigger(101);
          engine.addTrigger(trigger);

          await expect(
            runTriggers(engine, triggeringPatch)
          ).to.eventually.be.rejectedWith(
            'Trigger iteration limit of 99 exceeded'
          );
        });
      });

      if (dependencies) {
        describe('Dependencies', dependencies);
      }
    });

  suite('Strictly sequential mode', undefined, () => {
    let sandbox: sinon.SinonSandbox;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('triggers are run in registration order', async () => {
      const trigger1 = sandbox.stub();
      const trigger2 = sandbox.stub();
      const trigger3 = sandbox.stub();

      engine.addTrigger(trigger1);
      engine.addTrigger(trigger2);
      engine.addTrigger(trigger3);

      await runTriggers(engine, addTask('b'));

      sinon.assert.callOrder(trigger1, trigger2, trigger3);
    });

    it('triggers see effect of previous triggers in the same iteration', async () => {
      const nextTrigger = snapshot(
        sandbox.stub<[MyDocument, Operation[], MyDocument]>()
      );

      engine.addTrigger(priorityOfNewTask);
      engine.addTrigger(nextTrigger);

      await runTriggers(engine, addTask('b'));

      // Recall that the trigger will always be called at least twice, and we
      // need to verify the *first* call only
      const firstCall = nextTrigger.snapshots[0];
      expect(firstCall[0]).to.be.like({
        tasks: [
          {}, // Don't care about this one
          { label: 'b', priority: 'medium' },
        ],
      });
    });

    it('triggers get deltas of previous triggers in the same iteration', async () => {
      const nextTrigger = snapshot(
        sandbox.stub<[MyDocument, Operation[], MyDocument]>()
      );

      engine.addTrigger(priorityOfNewTask);
      engine.addTrigger(nextTrigger);

      await runTriggers(engine, addTask('b'));

      // Recall that the trigger will always be called at least twice, and we
      // need to verify the *first* call only
      const firstCall = nextTrigger.snapshots[0];
      // The first trigger added a property to an object that was added
      // in the original delta, so the patch seen by the second trigger
      // is actually optimized to still have just one operation that adds
      // the new object *with* the property value set by the first trigger
      expect(firstCall[1]).to.be.an('array').of.length(1);
      expect(firstCall[1][0]).to.be.like({
        op: 'add',
        path: '/tasks/1',
        value: { label: 'b', priority: 'medium' },
      });
    });

    it('triggers do not get incremental previous document states', async () => {
      const nextTrigger = snapshot(
        sandbox.stub<[MyDocument, Operation[], MyDocument]>()
      );

      engine.addTrigger(priorityOfNewTask);
      engine.addTrigger(nextTrigger);

      await runTriggers(engine, addTask('b'));

      // Recall that the trigger will always be called at least twice, and we
      // need to verify the *first* call only
      const firstCall = nextTrigger.snapshots[0];
      expect(firstCall[2])
        .to.have.property('tasks')
        .that.is.an('array')
        .of.length(1);
    });
  });

  suite('Parallel mode', { parallel: true }, () => {
    let sandbox: sinon.SinonSandbox;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
      engine = new TriggerEngineImpl({ parallel: true });
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('triggers all see same model state', async () => {
      const nextTrigger = snapshot(
        sandbox.stub<[MyDocument, Operation[], MyDocument]>()
      );

      engine.addTrigger(priorityOfNewTask);
      engine.addTrigger(nextTrigger);

      await runTriggers(engine, addTask('b'));

      // Recall that the trigger will always be called at least twice, and we
      // need to verify the *first* call only
      const firstCall = nextTrigger.snapshots[0];
      expect(firstCall[0]).to.be.like({
        tasks: [
          {}, // Don't care about this one
          { label: 'b' },
        ],
      });

      // This will be added in the future by the patch from the previous trigger
      expect(firstCall[0].tasks[1]).not.to.have.property('priority');
    });

    it('triggers all get the same deltas', async () => {
      const nextTrigger = snapshot(
        sandbox.stub<[MyDocument, Operation[], MyDocument]>()
      );

      engine.addTrigger(priorityOfNewTask);
      engine.addTrigger(nextTrigger);

      await runTriggers(engine, addTask('b'));

      // Recall that the trigger will always be called at least twice, and we
      // need to verify the *first* call only
      const firstCall = nextTrigger.snapshots[0];
      expect(firstCall[1]).to.be.an('array').of.length(1);
      expect(firstCall[1][0]).to.be.like({
        op: 'add',
        path: '/tasks/1',
        value: { label: 'b' },
      });
      const addOp = firstCall[1][0] as AddOperation<Partial<Task>>;
      // The property set by the first trigger is not (yet) in the delta
      expect(addOp.value).not.to.have.property('priority');
    });

    it('triggers do not get incremental previous document states', async () => {
      const nextTrigger = snapshot(
        sandbox.stub<[MyDocument, Operation[], MyDocument]>()
      );

      engine.addTrigger(priorityOfNewTask);
      engine.addTrigger(nextTrigger);

      await runTriggers(engine, addTask('b'));

      // Recall that the trigger will always be called at least twice, and we
      // need to verify the *first* call only
      const firstCall = nextTrigger.snapshots[0];
      expect(firstCall[2])
        .to.have.property('tasks')
        .that.is.an('array')
        .of.length(1);
    });
  });
});

async function runTriggers(
  engine: TriggerEngineImpl,
  patch: Operation[]
): Promise<Operation[] | undefined> {
  return engine.applyTriggers(...modifyDocument(patch));
}

function modifyDocument(
  patch: Operation[]
): [document: MyDocument, delta: Operation[], previousDocument: MyDocument] {
  const previousDocument = cloneDeep(originalDocument);
  // This creates a copy, not modifying the `previousDocument`
  const document = applyPatch(
    previousDocument,
    patch,
    false,
    false
  ).newDocument;
  // Calculate a diff to ensure that we don't have '/-' segments for array appends
  const delta = compare(previousDocument, document, true);
  return [document, delta, previousDocument];
}

function addTask(label: string): Operation[] {
  return [{ op: 'add', path: '/tasks/-', value: { label } }];
}

function setPriority(
  document: MyDocument,
  taskOffset: number,
  priority: Priority
): Operation[] | undefined {
  const taskIndex =
    taskOffset >= 0 ? taskOffset : document.tasks.length + taskOffset;
  const task = document.tasks[taskIndex];
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

function updateMediumPrioTasks(document: MyDocument): Operation[] | undefined {
  const oldValue = document.mediumPrioTasks;
  const newValue = document.tasks.reduce(
    (count, task) => (task.priority !== 'medium' ? count : count + 1),
    0
  );

  if (newValue != oldValue) {
    return [{ op: 'replace', path: '/mediumPrioTasks', value: newValue }];
  }
  return undefined;
}

/** Wrap a trigger to fire at most once. */
function once<T extends object = object>(trigger: Trigger<T>): Trigger<T> {
  let fired = false;
  return (doc, delta, prev) => {
    if (!fired) {
      fired = true;
      return trigger(doc, delta, prev);
    }
    return undefined;
  };
}

/** Wrap a trigger to capture a snapshot of its arguments. */
function snapshot<T extends object = object>(
  trigger: Trigger<T>
): Trigger<T> & { snapshots: Parameters<Trigger<T>>[] } {
  const snapshots: Parameters<Trigger<T>>[] = [];

  const result = (doc: T, delta: Operation[], prev: T) => {
    snapshots.push([cloneDeep(doc), cloneDeep(delta), cloneDeep(prev)]);
    return trigger(doc, delta, prev);
  };

  result.snapshots = snapshots;
  return result;
}

/** A trigger that initializes the priority of a newly added task. */
const priorityOfNewTask: Trigger<MyDocument> = async (doc, delta) => {
  const op = delta.find((op) => op.op === 'add');
  if (!op) {
    return undefined;
  }

  const match = /\/tasks\/(-|\d+)/.exec(op.path);
  if (!match) {
    return undefined;
  }
  const taskIndex = match[1] === '-' ? -1 : Number(match[1]);
  return setPriority(doc, taskIndex, 'medium');
};

/** A trigger recounts the medium priority tasks when a task's priority is changed. */
const recountMediumPrioTasks: Trigger<MyDocument> = (doc, delta) => {
  const op = delta[0];
  if (
    (op.op === 'add' || op.op === 'replace') &&
    /\/tasks\/\d+\/priority/.test(op.path)
  ) {
    return updateMediumPrioTasks(doc);
  }
  return undefined;
};

type RepeatTrigger = Trigger<MyDocument> & {
  iterationCount: number;
  interimStates: MyDocument[];
};
const repeatTrigger: (iterationCount?: number) => RepeatTrigger = (
  iterationCount = 100
) => {
  let performed = 0;
  const interimStates: MyDocument[] = [];

  const result: RepeatTrigger = (_document, _delta, previousDocument) => {
    if (performed++ >= iterationCount) {
      return [];
    }

    interimStates.push(previousDocument);

    // Blindly add another task
    return [
      {
        op: 'add',
        path: '/tasks/-',
        value: { label: `task ${performed}` },
      },
    ];
  };

  result.iterationCount = iterationCount;
  result.interimStates = interimStates;

  return result;
};

function createAddTagsTrigger(...tags: string[]): Trigger<MyDocument> {
  const tagsToAdd = [...tags];

  return async (_, delta) => {
    const result: Operation[] = [];

    for (const op of addOrReplaceOperations(delta)) {
      if (/^\/tasks\/[0-9]+$/.test(op.path)) {
        // Added a task. Shift and add one of our tags, if any remain
        const tag = tagsToAdd.shift();
        if (tag) {
          if (op.value && typeof op.value === 'object' && 'tags' in op.value) {
            result.push({ op: 'add', path: `${op.path}/tags/-`, value: tag });
          } else {
            result.push({ op: 'add', path: `${op.path}/tags`, value: [tag] });
          }
        }
      }
    }
    return result;
  };
}

function createAddTaskIfTagAddedTrigger(tag: string): Trigger<MyDocument> {
  return async (_, delta) => {
    const result: Operation[] = [];

    for (const op of addOrReplaceOperations(delta)) {
      // Did we either
      // (a) add the tag to an existing list of tags?
      // (b) add the tag in a new list of tags to a task?
      // (c) add a new task having the tag?
      if (
        (/^\/tasks\/[0-9]+\/tags\/[0-9]+$/.test(op.path) && op.value === tag) ||
        (/^\/tasks\/[0-9]+\/tags$/.test(op.path) &&
          (op.value as string[]).includes(tag)) ||
        (/^\/tasks\/[0-9]+$/.test(op.path) &&
          ((op.value as Task).tags ?? []).includes(tag))
      ) {
        // Added our target tag. Add a task
        const task: Task = { label: `task for tag '${tag}'`, priority: 'low' };
        result.push({ op: 'add', path: '/tasks/-', value: task });
        break; // Only add one
      }
    }
    return result;
  };
}
