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
import {
  FrontendModelHub,
  FrontendModelHubProvider,
} from '@eclipse-emfcloud/model-service-theia/lib/browser';
import { Emitter } from '@theia/core';
import { inject, injectable } from '@theia/core/shared/inversify';
import { ModelBInternalClient } from '../common';

/** Event notifying of the creation of a `FrontendModelHub` in the frontend. */
export interface ModelHubCreatedEvent {
  /** The context of the model hub that was created. */
  context: string;
  /** The model hub that was created. */
  modelHub: FrontendModelHub<string>;
}

@injectable()
export class ModelBInternalAPIWatcher {
  @inject(FrontendModelHubProvider)
  private readonly modelHubProvider: FrontendModelHubProvider<string>;

  private readonly onModelHubCreatedEmitter =
    new Emitter<ModelHubCreatedEvent>();
  public readonly onModelHubCreated = this.onModelHubCreatedEmitter.event;

  getInternalAPIClient(): ModelBInternalClient {
    const modelHubProvider = this.modelHubProvider;
    const emitter = this.onModelHubCreatedEmitter;

    return {
      onModelHubCreated: (event) => {
        modelHubProvider(event.context.toString()).then((modelHub) =>
          emitter.fire({ context: event.context, modelHub })
        );
      },
    };
  }
}
