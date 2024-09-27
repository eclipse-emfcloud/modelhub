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

import {
  DefaultProvider,
  ModelAccessorBus,
  ModelAccessorBusImpl,
} from '@eclipse-emfcloud/model-accessor-bus';
import {
  Command,
  CommandStack,
  ModelManager,
  append,
  createModelManager,
  createModelUpdaterCommand,
  isCompoundCommand,
} from '@eclipse-emfcloud/model-manager';
import { Operation } from 'fast-json-patch';
import { isEqual } from 'lodash';
import { afterAsyncs, inspect } from './helpers';
import { PackageTracking, Shipment } from './package-tracking';
import { ShipmentStatus, ShippingContractors } from './shipping-contractors';

class ShippingModelProvider extends DefaultProvider {
  modelId: string;
  modelManager: ModelManager<string>;
  constructor(modelId: string, modelManager: ModelManager<string>) {
    super('shipping');
    this.modelId = modelId;
    this.modelManager = modelManager;
    this.isPackageDelivered = this.isPackageDelivered.bind(this);

    this.accessors.set('delivered', this.isPackageDelivered);

    const subscription = modelManager.subscribe(this.modelId);
    subscription.onModelChanged = (
      _modelId: string,
      _model: object,
      delta?: Operation[]
    ) => {
      if (delta?.some((op) => op.path.endsWith('/status'))) {
        this.notify('delivered');
      }
    };
  }

  private isPackageDelivered(shipment: Shipment) {
    const model = this.modelManager.getModel<ShippingContractors>(this.modelId);
    const packageInfo = model?.contractors
      .find((contractor) => contractor.name === shipment.contractor)
      ?.packages.find(
        (pack) =>
          isEqual(pack.shipment.recipient, shipment.recipient) &&
          isEqual(pack.shipment.shipTo, shipment.shipTo)
      );
    return packageInfo?.status === 'DELIVERED';
  }
}

function createPackageTrackingModel() {
  const modelManager: ModelManager<string> = createModelManager();
  modelManager.setModel('example:packages.shipping', {
    shipments: [
      {
        recipient: { lastName: 'Brown', firstName: 'Alice' },
        shipTo: {
          numberAndStreet: '123 Front Street',
          city: 'Exampleville',
          province: 'Ontario',
          country: 'Canada',
        },
        contractor: 'DHL',
        delivered: false,
      },
    ],
  });

  modelManager.setModel('example:packages.shippingContractors', {
    contractors: [
      { name: 'UPS', packages: [] },
      {
        name: 'DHL',
        packages: [
          {
            shipment: {
              recipient: { lastName: 'Brown', firstName: 'Alice' },
              shipTo: {
                numberAndStreet: '123 Front Street',
                city: 'Exampleville',
                province: 'Ontario',
                country: 'Canada',
              },
            },
            status: 'OUT-FOR-DELIVERY',
          },
        ],
      },
    ],
  });
  return modelManager;
}

function createModelAccessorBus(modelManager: ModelManager<string>) {
  const accessorBus = new ModelAccessorBusImpl();

  //Shipping Contractors Model
  const shippingProvider = new ShippingModelProvider(
    'example:packages.shippingContractors',
    modelManager
  );
  accessorBus.register(shippingProvider);

  //Package Tracking Model
  accessorBus.subscribe('shipping.delivered', () => {
    handleDeliveredAccessorStatusChanged(modelManager, accessorBus);
  });
}

async function handleDeliveredAccessorStatusChanged(
  modelManager: ModelManager<string>,
  accessorBus: ModelAccessorBus
) {
  const packageTracking = modelManager.getModel<PackageTracking>(
    'example:packages.shipping'
  )!;
  const commands = await packageTracking.shipments.reduce(
    async (resultPromise, shipment) => {
      const result = await resultPromise;

      if (!shipment.delivered) {
        // get the new value
        const delivered = (await accessorBus.get(
          'shipping.delivered',
          shipment
        )) as boolean;
        if (delivered) {
          const updateShippingCommand = getSetShippingDeliveredCommand(
            modelManager,
            shipment
          );
          if (updateShippingCommand) {
            result.push(updateShippingCommand);
          }
        }
      }
      return result;
    },
    Promise.resolve([] as Command<string>[])
  );
  await updateModel(modelManager, commands, true);
}

async function updateModel(
  modelManager: ModelManager<string>,
  commands: Command<string>[],
  sync: boolean
) {
  if (!commands.length) {
    return;
  }
  let command;

  if (commands.length > 1) {
    const [firstCommand, ...otherCommands] = commands;
    command = append(firstCommand, ...otherCommands);
  } else {
    command = commands[0];
  }

  const stack: CommandStack<string> = modelManager.getCommandStack(
    sync ? 'model sync' : 'main'
  );

  const delta = await stack.execute(command);

  if (delta) {
    for (const [cmd, patch] of delta) {
      if (!isCompoundCommand(cmd)) {
        console.log('Model update:', cmd.modelId, inspect(patch));
      }
    }
  }
}

function getSetShippingDeliveredCommand(
  modelManager: ModelManager<string>,
  shipment: Shipment
) {
  const packageTracking = modelManager.getModel<PackageTracking>(
    'example:packages.shipping'
  )!;
  const index = packageTracking.shipments.findIndex((element) =>
    isEqual(element, shipment)
  );
  if (index >= 0) {
    return createModelUpdaterCommand(
      'Set Shipping Delivered',
      'example:packages.shipping',
      (model: PackageTracking) => (model.shipments[index].delivered = true)
    );
  }
  return undefined;
}

async function setShipmentStatus(
  modelManager: ModelManager<string>,
  contractorIndex: number,
  packageIndex: number,
  newStatus: ShipmentStatus
) {
  const command = createModelUpdaterCommand(
    'Set Shipment Status',
    'example:packages.shippingContractors',
    (model: ShippingContractors) => {
      model.contractors[contractorIndex].packages[packageIndex].status =
        newStatus;
    }
  );
  await updateModel(modelManager, [command], false);
}

async function main() {
  const modelManager = createPackageTrackingModel();
  createModelAccessorBus(modelManager);

  function dumpModels() {
    const packageTracking = modelManager.getModel<PackageTracking>(
      'example:packages.shipping'
    );
    console.log('Package Tracking:', inspect(packageTracking));

    const contractors = modelManager.getModel<ShippingContractors>(
      'example:packages.shippingContractors'
    );
    console.log('Shipping Contractors:', inspect(contractors));
  }

  dumpModels();

  //   Package Tracking: {
  //   shipments: [
  //     {
  //       recipient: { lastName: 'Brown', firstName: 'Alice' },
  //       shipTo: {
  //         numberAndStreet: '123 Front Street',
  //         city: 'Exampleville',
  //         province: 'Ontario',
  //         country: 'Canada'
  //       },
  //       contractor: 'DHL',
  //       delivered: false
  //     }
  //   ]
  // }
  // Shipping Contractors: {
  //   contractors: [
  //     { name: 'UPS', packages: [] },
  //     {
  //       name: 'DHL',
  //       packages: [
  //         {
  //           shipment: {
  //             recipient: { lastName: 'Brown', firstName: 'Alice' },
  //             shipTo: {
  //               numberAndStreet: '123 Front Street',
  //               city: 'Exampleville',
  //               province: 'Ontario',
  //               country: 'Canada'
  //             }
  //           },
  //           status: 'OUT-FOR-DELIVERY'
  //         }
  //       ]
  //     }
  //   ]
  // }

  await setShipmentStatus(modelManager, 1, 0, 'DELIVERED');

  afterAsyncs(dumpModels);

  //   Package Tracking: {
  //   shipments: [
  //     {
  //       recipient: { lastName: 'Brown', firstName: 'Alice' },
  //       shipTo: {
  //         numberAndStreet: '123 Front Street',
  //         city: 'Exampleville',
  //         province: 'Ontario',
  //         country: 'Canada'
  //       },
  //       contractor: 'DHL',
  //       delivered: true
  //     }
  //   ]
  // }
  // Shipping Contractors: {
  //   contractors: [
  //     { name: 'UPS', packages: [] },
  //     {
  //       name: 'DHL',
  //       packages: [
  //         {
  //           shipment: {
  //             recipient: { lastName: 'Brown', firstName: 'Alice' },
  //             shipTo: {
  //               numberAndStreet: '123 Front Street',
  //               city: 'Exampleville',
  //               province: 'Ontario',
  //               country: 'Canada'
  //             }
  //           },
  //           status: 'DELIVERED'
  //         }
  //       ]
  //     }
  //   ]
  // }
}
main();
