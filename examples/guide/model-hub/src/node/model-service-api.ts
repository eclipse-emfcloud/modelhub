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
import { Command } from '@eclipse-emfcloud/model-manager';
import { Address } from '../common';

export type CanadianAddress = Omit<
  Address,
  'state' | 'otherAdministrativeSubdivision'
> &
  Required<Pick<Address, 'province'>>;
export type USAustralianAddress = Omit<
  Address,
  'province' | 'otherAdministrativeSubdivision'
> &
  Required<Pick<Address, 'state'>>;
export type OtherAddress = Omit<Address, 'state' | 'province'> &
  Required<Pick<Address, 'otherAdministrativeSubdivision'>>;
export type SomeAddress = CanadianAddress | USAustralianAddress | OtherAddress;

export type AddressBookAPI = {
  getAddEntryCommand(
    modelId: string,
    lastName: string,
    firstName: string,
    address: SomeAddress
  ): Command<string> | undefined;
  getAddAddressCommand(
    modelId: string,
    lastName: string,
    firstName: string,
    address: SomeAddress
  ): Command<string> | undefined;
};
