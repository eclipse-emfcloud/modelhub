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

import type { ChangeSubscription, CoreModelManager } from '../core';
import { CoreModelManagerImpl } from '../impl';
import {
  CommandStack,
  CommandStackImpl,
  CommandStackOptions,
} from './command-stack';

/**
 * A manager of models, providing {@link CommandStack}s with which to
 * edit them and {@link ChangeSubscription}s with which to monitor them
 * for changes.
 * This is a façade on the {@link CoreModelManager} interface for the common
 * use cases of client applications that manage editing and undo/redo on
 * their models independently of all other models.
 *
 * @template K the type of key with which a model is associated
 */
export interface ModelManager<K>
  extends Omit<CoreModelManager<K>, 'getCommandStack' | 'getEditingContexts'> {
  /**
   * Get the {@link CommandStack} with the given identifier for editing the models that I manage.
   * The semantics of the identifier are not defined by the framework.
   *
   * @param id an unique identifier for a command stack to retrieve
   * @param [options] optional configuration of the returned stack.
   *   If omitted, all options assume their default values.
   * @returns the command stack
   */
  getCommandStack(id: string, options?: CommandStackOptions): CommandStack<K>;

  /**
   * Query the IDs of command stacks that currently have associated command histories and/or dirty state.
   * If a command stack has been {@linkplain CommandStack.flush flushed} but still {@linkplain CommandStack.getDirtyModels is dirty}, then its ID will be returned in the result.
   * Otherwise, the command stack ID effectively no longer exists and will not be returned in the result.
   */
  getCommandStackIds(): string[];
}

/**
 * Create a new model manager that delegates to a core implementation.
 *
 * @param delegate the core model manager to which I delegate my behaviour.
 *   Omit the `delegate` to use the default implementation
 * @returns the model manager
 */
export const createModelManager = <K>(
  delegate?: CoreModelManager<K>
): ModelManager<K> => {
  return new ModelManagerImpl(delegate || new CoreModelManagerImpl());
};

export class ModelManagerImpl<K> implements ModelManager<K> {
  constructor(private readonly delegate: CoreModelManager<K>) {}

  getModel<M extends object = object>(modelId: K): M | undefined {
    return this.delegate.getModel(modelId);
  }

  getModelId(model: object): K | undefined {
    return this.delegate.getModelId(model);
  }

  getModelIds(): K[] {
    return this.delegate.getModelIds();
  }

  setModel(modelId: K, model: object): void {
    this.delegate.setModel(modelId, model);
  }

  removeModel<M extends object = object>(modelId: K): M | undefined {
    return this.delegate.removeModel(modelId);
  }

  subscribe<M extends object = object>(modelId?: K): ChangeSubscription<K, M> {
    return this.delegate.subscribe(modelId);
  }

  getCommandStack(id: string, options?: CommandStackOptions): CommandStack<K> {
    const actualOptions = { ...(options ?? {}), id };
    return new CommandStackImpl(this.delegate.getCommandStack(), actualOptions);
  }

  getCommandStackIds(): string[] {
    return this.delegate.getCommandStack().getEditingContexts();
  }
}
