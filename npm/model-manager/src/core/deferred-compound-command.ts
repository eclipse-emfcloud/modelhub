// *****************************************************************************
// Copyright (C) 2024 STMicroelectronics.
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

import { Command, CompoundCommand } from './command';
import { MaybePromise } from './promises';
import { DeferredCompoundCommand } from '../impl/deferred-compound-command-impl';

/**
 * The signature of a function that provides, just in time, the commands to add to
 * to a deferred compound. This function is called only when the commands are actually
 * need to execute them or, in the case of a _strict deferred compound_, to test them
 * for whether they can be executed. The function may be asynchronous, and the
 * commands that it returns may themselves be promises from asynchronous functions.
 *
 * A particularly convenient kind of function to supply as the provider is a
 * generator that yields commands as it determines that they are required, until
 * there are no further commands to provide.
 *
 * @param `getModel` a function that the provider may use to access the current
 *   state of a model identified by `modelId` to determine whether and which commands
 *   to provide
 * @returns the commands to include in the compound when it is executed
 */
export type CommandProvider<K> = (
  getModel: <M extends object>(modelId: K) => M | undefined
) => MaybePromise<Iterable<MaybePromise<Command<K>>>>;

/**
 * Signature of the optional precondition function for deferred compound commands.
 *
 * @param `getModel` a function that the predicate may use to access the current
 *   state of a model identified by `modelId`, to check conditions on it
 * @returns whether the deferred compound command is determined to be executable
 */
export type PreconditionPredicate<K> = (
  getModel: <M extends object>(modelId: K) => M | undefined
) => MaybePromise<boolean>;

/**
 * Create a compound command that dynamically computes its child commands, just in
 * time when executed. Because the determination of its member commands is deferred,
 * the deferred compound requires up-front declaration of the `scope` of commands that
 * it is intended to edit, so that it may exclude concurrent modifications of those
 * models while its own execution is pending. The `children` eventually computed need
 * not actually modify all models in this `scope` and they should not modify more
 * models than are declared in the `scope`, which could result in unpredictable
 * interference with other commands concurrently executed.
 *
 * While it is not anticipated to be typical usage, the resulting compound command
 * does support the explicit addition of child commands in addition to the deferred
 * provision of children. Any overlap or other interference between commands statically
 * and dynamically added is the responsibility of the client.
 *
 * @template  <K> the model ID type
 *
 * @param label a label for the compound command, suitable for presentation in some UI
 * @param scope the IDs of models that the compound command will edit
 * @param children a function providing the children to add to the compound just in time
 *    for them to be executed
 * @param precondition an optional predicate function to compute, without having to create
 *    them, whether the commands to be provided for execution will be executable.
 *    If omitted, it is assumed that the compound overall will be able to be executed
 */
export function createDeferredCompoundCommand<K = string>(
  label: string,
  scope: K[],
  children: CommandProvider<K>,
  precondition?: PreconditionPredicate<K>
): CompoundCommand<K> {
  return new DeferredCompoundCommand(label, scope, children, precondition);
}

/**
 * Create a compound command that dynamically computes its child commands, just in
 * time when needing to query whether they can be executed. This is different to the
 * {@link createDeferredCompoundCommand|more flexible deferred compound} in that the
 * children are provided at the time of testing whether the command can be executed,
 * delegating that precondition to the provided children in the usual manner of a
 * compound command. Thus the children are prepared earlier but are guaranteed not
 * to attempt their execution if any of them reports not being executable.
 *
 * @template  <K> the model ID type
 *
 * @param label a label for the compound command, suitable for presentation in some UI
 * @param scope the IDs of models that the compound command will edit
 * @param children a function providing the children to add to the compound just in time
 *    for them to be tested for executability
 *
 * @see {@link createDeferredCompoundCommand()}
 */
export function createStrictDeferredCompoundCommand<K = string>(
  label: string,
  scope: K[],
  children: CommandProvider<K>
): CompoundCommand<K> {
  return new DeferredCompoundCommand(label, scope, children, 'strict');
}
