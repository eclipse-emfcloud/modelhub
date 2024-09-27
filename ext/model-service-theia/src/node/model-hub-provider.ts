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

import { ModelHub } from '@eclipse-emfcloud/model-service';

/**
 * Provider of Model Hubs for string contexts, injectable via Inversify.
 */
export type ModelHubProvider<K = string, C extends string = string> = (
  context: C
) => Promise<ModelHub<K, C>>;

/** Service identifier for the Model Hub provider. */
export const ModelHubProvider = Symbol('ModelHubProvider');
