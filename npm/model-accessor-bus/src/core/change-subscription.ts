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

export type ProviderChangeListener = (id: string) => void;

/**
 * Interface of an object that provides notification of updates
 * which should trigger calling some accessors to possibly get new return values.
 */
export interface ProviderChangeSubscription {
  /**
   * Terminate the subscription. After the subscription is closed,
   * the {@link onModelChanged} call-back will not be invoked
   * for any future model change.
   */
  close(): void;
}
