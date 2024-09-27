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

import { Shipment } from './package-tracking';
export type ShippingContractors = {
  contractors: {
    name: string;
    packages: {
      shipment: Omit<Shipment, 'contractor' | 'delivered'>;
      status: ShipmentStatus;
    }[];
  }[];
};

export type ShipmentStatus =
  | 'IN-TRANSIT'
  | 'OUT-FOR-DELIVERY'
  | 'DELIVERED'
  | 'RETURNED';
