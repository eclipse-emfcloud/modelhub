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

/**
 * Injection key for the application context of the model hub.
 * For child containers providing services scoped to a particular
 * context, this can be used to inject that context into the
 * Model Services framework to define the `ModelHub` context.
 */
export const ModelHubContext = Symbol('ModelHubContext');

/**
 * Injection key for direct injection of the model hub in child
 * containers scoped to that hub's context.
 * For child containers providing services scoped to a particular
 * context, this can be used to inject that context's `ModelHub`.
 */
export const ModelHub = Symbol('ModelHub');
