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

/* eslint-disable @typescript-eslint/no-non-null-assertion */
import chai, { expect } from 'chai';
import chaiLike from 'chai-like';
import chaiThings from 'chai-things';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';

import {
  Command,
  CommandStack,
  CompoundCommandImpl,
  CoreModelManager,
  createModelPatchCommand,
  createModelUpdaterCommand,
} from '@eclipse-emfcloud/model-manager';
import { WorkingCopyManager } from '@eclipse-emfcloud/model-manager/lib/impl/core-command-stack-impl';
import {
  addOperations,
  addOrReplaceOperations,
} from '@eclipse-emfcloud/trigger-engine';
import { getValueByPointer, Operation } from 'fast-json-patch';
import { cloneDeep } from 'lodash';
import { ModelTrigger } from '../../api/model-trigger';
import {
  createModelServiceModelManager,
  ModelManagerSubscription,
  ModelServiceModelManager,
} from '../model-service-model-manager';

chai.use(chaiLike);
chai.use(chaiThings);
chai.use(sinonChai);

const alice = {
  name: 'Alice',
  id: '88BB5693-D51C-4BAE-9CC0-197E51304390',
  registeredOn: '19-07-2023',
};
const bob = { name: 'Bob', id: 'A713B4E9-E5D5-4F23-8FF2-FD39800A08D5' };
const modelAImage = {
  name: 'Customer Data',
  lastRegistration: alice.registeredOn,
  customers: [alice],
};

const keyboard = { sku: '11342720', name: 'keyboard' };
const mouse = { sku: '11855065', name: 'mouse' };
const aliceKeyboard = {
  customer: alice.id,
  sku: keyboard.sku,
  date: '24-07-2023',
};
const bobMouse = { customer: bob.id, sku: mouse.sku };
const modelBImage = {
  name: 'Business Data',
  lastOrder: aliceKeyboard.date,
  products: [keyboard, mouse],
  orders: [aliceKeyboard],
};

type ModelA = typeof modelAImage;
type ModelB = typeof modelBImage;
type Customer = ModelA['customers'][number];
type Order = ModelB['orders'][number];

const MODEL_A_ID = 'test://38BCC304-652F-4C27-A225-81BF6C8EDCA8/model';
const MODEL_B_ID = 'test://4CE1EB0C-99AA-4ABE-B531-7618ED1174DC/model';
const MODEL_A2_ID = 'test://7D0A76E0-BB74-4F99-9FEF-D2A66874D785/model';

describe('ModelServiceModelManager', () => {
  let modelManager: ModelServiceModelManager<string>;
  let commandStack: CommandStack;
  const getModelA = () => modelManager.getModel<ModelA>(MODEL_A_ID)!;
  const getModelB = () => modelManager.getModel<ModelB>(MODEL_B_ID)!;

  beforeEach(() => {
    const modelA = cloneDeep(modelAImage);
    const modelB = cloneDeep(modelBImage);
    modelManager = createModelServiceModelManager();
    modelManager.setModel(MODEL_A_ID, modelA);
    modelManager.setModel(MODEL_B_ID, modelB);

    modelManager.triggerEngine.addModelTrigger(customerRegistration);
    modelManager.triggerEngine.addModelTrigger(orderDate);

    commandStack = modelManager.getCommandStack('test');
  });

  describe('multiple models', () => {
    it('multiple models triggered', async () => {
      const addBob = createModelUpdaterCommand<string, ModelA>(
        'Add Bob',
        MODEL_A_ID,
        (model) => {
          model.customers.push(cloneDeep(bob) as Customer);
        }
      );
      const orderMouse = createModelUpdaterCommand<string, ModelB>(
        'Order Mouse',
        MODEL_B_ID,
        (model) => {
          model.orders.push(cloneDeep(bobMouse) as Order);
        }
      );

      const commandResult = await commandStack.execute(
        new CompoundCommandImpl('Add Bob and Order Mouse', addBob, orderMouse)
      );

      // Assertions on models
      expect(getModelA().customers).to.contain.an.item.like({
        ...bob,
        registeredOn: '24-07-2023',
      });
      expect(getModelB().orders).to.contain.an.item.like({
        ...bobMouse,
        date: '24-07-2023',
      });

      // Assertions on command result
      expect(commandResult).to.exist;
      const triggerCommands = Array.from(commandResult!.entries()).filter(
        ([key, _]) => key.label === 'Apply triggers'
      );

      // One per model
      expect(triggerCommands).to.have.length.at.least(2);
      expect(triggerCommands).to.contain.an.item.like([
        { modelId: MODEL_A_ID },
        [
          { op: 'add', path: '/customers/1/registeredOn' },
          { op: 'test' },
          { op: 'replace', path: '/lastRegistration' },
        ],
      ]);
      // The ModelB trigger didn't have to update /lastOrder
      expect(triggerCommands).to.contain.an.item.like([
        { modelId: MODEL_B_ID },
        [{ op: 'add', path: '/orders/1/date' }],
      ]);
    });
  });

  describe('change notifications', () => {
    it('notification includes trigger changes', async () => {
      const sub = modelManager.subscribe(MODEL_A_ID);
      const modelChanged = sinon.stub();
      sub.onModelChanged = modelChanged;

      const addBob = createModelUpdaterCommand<string, ModelA>(
        'Add Bob',
        MODEL_A_ID,
        (model) => {
          model.customers.push(cloneDeep(bob) as Customer);
        }
      );
      await commandStack.execute(addBob);

      sinon.assert.calledOnceWithMatch(modelChanged, MODEL_A_ID, getModelA(), [
        // The initial addition of the object
        {
          op: 'add',
          path: '/customers/1',
          value: { name: 'Bob', id: 'A713B4E9-E5D5-4F23-8FF2-FD39800A08D5' },
        },
        // The trigger setting the registeredOn property of the new object
        { op: 'add', path: '/customers/1/registeredOn', value: '24-07-2023' },
        sinon.match({ op: 'test' }),
        {
          op: 'replace',
          path: '/lastRegistration',
          value: '24-07-2023',
        },
      ]);
    });
  });

  describe('load notifications', () => {
    let modelA2: ModelA;

    beforeEach(() => {
      modelA2 = cloneDeep(modelAImage);
    });

    it('notifies on model added', () => {
      const sub: ModelManagerSubscription = modelManager.subscribe();
      const modelLoaded = sinon.stub();
      sub.onModelLoaded = modelLoaded;

      modelManager.setModel(MODEL_A2_ID, modelA2);

      sinon.assert.calledOnceWithExactly(modelLoaded, MODEL_A2_ID);
    });
  });

  describe('unload notifications', () => {
    let modelA2: ModelA;

    beforeEach(() => {
      modelA2 = cloneDeep(modelAImage);
      modelManager.setModel(MODEL_A2_ID, modelA2);
    });

    it('notifies on model removed', () => {
      const sub: ModelManagerSubscription = modelManager.subscribe();
      const modelUnloaded = sinon.stub();
      sub.onModelUnloaded = modelUnloaded;

      const removed = modelManager.removeModel(MODEL_A2_ID);

      sinon.assert.calledOnceWithExactly(modelUnloaded, MODEL_A2_ID, removed);
    });

    it("doesn't notify on absent model", () => {
      modelManager.removeModel(MODEL_A2_ID);

      const sub: ModelManagerSubscription = modelManager.subscribe();
      const modelUnloaded = sinon.stub();
      sub.onModelUnloaded = modelUnloaded;

      modelManager.removeModel(MODEL_A2_ID);

      sinon.assert.notCalled(modelUnloaded);
    });
  });

  describe('Corner Cases', () => {
    let applyTriggers: (
      commandResult: Map<Command, Operation[]> | undefined
    ) => Promise<Command | undefined>;
    let exposedCoreModelManager: CoreModelManager<string> & {
      _modelStore: WorkingCopyManager;
      applyTriggers(
        workingCopyManager: WorkingCopyManager,
        commandResult: Map<Command, Operation[]> | undefined
      ): Promise<Command | undefined>;
    };
    let exposedModelManager: ModelServiceModelManager<string> & {
      delegate: typeof exposedCoreModelManager;
    };

    beforeEach(() => {
      exposedModelManager =
        modelManager as unknown as typeof exposedModelManager;
      exposedCoreModelManager = exposedModelManager.delegate;
      const workingCopyManager = exposedCoreModelManager._modelStore;
      workingCopyManager.open([MODEL_A_ID, MODEL_A2_ID, MODEL_B_ID]); // Need it open to test triggers with it
      applyTriggers = (commandResult) =>
        exposedCoreModelManager.applyTriggers(
          workingCopyManager,
          commandResult
        );
    });

    it('correctly applies triggers to undefined command results', async () => {
      const result = applyTriggers(undefined);
      return expect(result).eventually.not.to.exist;
    });

    it('correctly processes triggers for result of command that has no model', async () => {
      const delta1: Operation[] = [
        { op: 'add', path: '/orders/0', value: aliceKeyboard },
      ];
      const badCommand = createModelPatchCommand(
        'test',
        MODEL_B_ID,
        () => delta1
      );
      sinon.stub(badCommand, 'modelId').value(undefined);

      getModelA().customers.push(cloneDeep(bob) as typeof alice);
      const delta2: Operation[] = [
        { op: 'add', path: '/customers/1', value: bob },
      ];
      const goodCommand = createModelPatchCommand(
        'test',
        MODEL_A_ID,
        () => delta2
      );

      const triggeringResults = new Map<Command, Operation[]>([
        [badCommand, delta1],
        [goodCommand, delta2],
      ]);

      const result = await applyTriggers(triggeringResults);
      expect(result).to.exist;
      expect(result).to.be.like({
        label: 'Apply triggers',
        modelId: MODEL_A_ID,
        state: 'ready',
      });
    });

    it('tolerates CompoundCommands in the triggering command-result map', async () => {
      const delta1: Operation[] = [
        { op: 'add', path: '/orders/0', value: aliceKeyboard },
      ];
      const badCommand = new CompoundCommandImpl('test');

      getModelA().customers.push(cloneDeep(bob) as typeof alice);
      const delta2: Operation[] = [
        { op: 'add', path: '/customers/1', value: bob },
      ];
      const goodCommand = createModelPatchCommand(
        'test',
        MODEL_A_ID,
        () => delta2
      );

      const triggeringResults = new Map<Command, Operation[]>([
        [badCommand, delta1],
        [goodCommand, delta2],
      ]);

      const result = await applyTriggers(triggeringResults);
      expect(result).to.exist;
      expect(result).to.be.like({
        label: 'Apply triggers',
        modelId: MODEL_A_ID,
        state: 'ready',
      });
    });
  });
});

function set(model: object, path: string, value: unknown): Operation {
  const op = getValueByPointer(model, path) === undefined ? 'add' : 'replace';
  return { op, path, value };
}

/** A trigger that initializes the registration date of a newly added customer. */
const customerRegistration: ModelTrigger<string, ModelA> = {
  getPatch: async (modelId, model, delta) => {
    const op = addOperations(delta)[0];
    if (modelId == MODEL_A_ID && op && /^\/customers\/\d+$/.test(op.path)) {
      return [
        set(model, `${op.path}/registeredOn`, '24-07-2023'),
        set(model, '/lastRegistration', '24-07-2023'),
      ];
    }
    return undefined;
  },
};

/** A trigger that initializes the date of a newly added order. */
const orderDate: ModelTrigger<string, ModelB> = {
  getPatch: (modelId, model, delta) => {
    const op = addOrReplaceOperations(delta)[0];
    if (op && modelId == MODEL_B_ID && /^\/orders\/\d+$/.test(op.path)) {
      return [
        set(model, `${op.path}/date`, '24-07-2023'),
        set(model, '/lastOrder', '24-07-2023'),
      ];
    }
    return undefined;
  },
};
