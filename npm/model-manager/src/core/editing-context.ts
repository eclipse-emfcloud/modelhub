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
 * An abstract representation of some context in which a model may be edited.
 * Command`s are executed on a `CoreCommandStack` in one or more contexts that they
 * affect, and in which contexts they may then subsequently be undone and redone.
 *
 * The semantics of an editing context, what it represents in the application, is
 * not defined by the framework.
 *
 * @type EditingContext
 */
export type EditingContext = string;
