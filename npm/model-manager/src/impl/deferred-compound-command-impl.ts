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

import { getLogger } from '@eclipse-emfcloud/model-logger';
import { Command, CommandResult, CompoundCommandImpl } from '../core/command';
import {
  CommandProvider,
  PreconditionPredicate,
} from '../core/deferred-compound-command';
import { getModelIds } from './core-command-stack-impl';

const logger = getLogger('model-manager/deferred-compound-command-impl');
type GetModel<K> = Parameters<CommandProvider<K>>[0];

/**
 * Implementation of a compound command that permits deferred computation of its child
 * commands with up-front declaration of the scope of models that it will edit.
 */
export class DeferredCompoundCommand<
  K = string
> extends CompoundCommandImpl<K> {
  /**
   * The model IDs describing the scope of models that I will edit.
   */
  private readonly _modelScope: K[];

  /**
   * Whether I have prepared my child commands. This is tracked as a separate state
   * from my child commands because it cannot be inferred from them: my command
   * provider may provide no commands and moreover commands may be statically added
   * to me in the usual manner.
   */
  private _prepared = false;

  /**
   * Initializes me with my scope and a function that prepares my child commands.
   *
   * @label my label, for presentation in the UI
   * @param scope the scope of models that it is anticipated will be covered by the command
   *   when it is {@link prepare}d. This can be wider than what is eventually
   *   required but should not be narrower.
   * @param commandProvider a function that provides an iterable over the commands to add and
   *   execute when it comes time to execute
   * @param precondition an optional precondition mode to check the {@link canExecute} condition.
   *   This may be the constant `'strict'` to prepare my child commands and check them, or a
   *   predicate function to check without first having to prepare my commands. If omitted,
   *   precondition check is optimistically sidelined, just returning `true`
   */
  constructor(
    label: string,
    modelScope: K[],
    private readonly commandProvider: CommandProvider<K>,
    private readonly precondition?: 'strict' | PreconditionPredicate<K>
  ) {
    super(label);
    this._modelScope = [...modelScope];
  }

  override async canExecute(getModel: GetModel<K>): Promise<boolean> {
    if (this.isReady() && !this.isPrepared()) {
      if (this.precondition === undefined) {
        return true;
      }

      if (this.precondition === 'strict') {
        await this.prepare(getModel);
        return super.canExecute(getModel);
      }

      return this.precondition(getModel);
    }

    // If we've already been executed, then the standard rule applies
    return super.canExecute(getModel);
  }

  async execute(getModel: GetModel<K>): CommandResult<K> {
    await this.prepare(getModel);
    return super.execute(getModel);
  }

  //
  // Deferred Compound protocol
  //

  /**
   * Query the scope of models edited by this command, including the set declared up-front
   * and declared by any commands already added, either statically or by the deferred provider.
   */
  get modelScope(): K[] {
    const result = new Set<K>(this._modelScope);
    this._commands
      .flatMap((next) => getModelIds(next))
      .forEach((modelId) => result.add(modelId));
    return Array.from(result);
  }

  /**
   * Query whether I have prepared my member commands from my deferred provider.
   */
  isPrepared(): boolean {
    return this._prepared;
  }

  /**
   * Prepare myself for execution by obtaining and appending the late-provided commands.
   *
   * @param getModel the model accessor to pass to my command provider
   */
  protected async prepare(getModel: GetModel<K>): Promise<void> {
    if (this.isPrepared()) {
      // Only prepare once
      return;
    }

    const childrenToAdd = await this.commandProvider(getModel);
    this._prepared = true;

    for (const next of childrenToAdd) {
      const childToAdd = this.validate(await next);
      if (childToAdd) {
        this.append(childToAdd);
      }
    }
  }

  protected validate(command: Command<K>): Command<K> | undefined {
    const modelIds = getModelIds(command);
    if (modelIds.some((modelId) => !this._modelScope.includes(modelId))) {
      // For now, this is just a warning, not a validation failure
      logger.warn(
        `Command '${command.label}' expands the model scope of deferred compound '${this.label}'.`
      );
    }
    return command;
  }
}
