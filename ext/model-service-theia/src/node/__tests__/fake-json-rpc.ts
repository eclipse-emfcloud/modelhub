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

import { ConnectionHandler, RpcConnectionHandler } from '@theia/core';
import {
  Container,
  injectable,
  interfaces,
  multiInject,
} from '@theia/core/shared/inversify';

@injectable()
export class RpcConnectionFactory {
  @multiInject(ConnectionHandler)
  protected connectionHandlers: ConnectionHandler[];

  async getServer<RPC>(
    servicePath: string,
    clientProxy?: object
  ): Promise<RPC> {
    for (const handler of this.connectionHandlers) {
      if (
        handler instanceof RpcConnectionHandler &&
        handler.path === servicePath
      ) {
        return handler.targetFactory(clientProxy);
      }
    }

    throw new Error(`No handler for service at path '${servicePath}'`);
  }
}

export function bindFakeRpcConnectionFactory(
  binder: interfaces.Bind | Container
): void {
  const bind = binder instanceof Container ? binder.bind.bind(binder) : binder;
  bind(RpcConnectionFactory).toSelf().inSingletonScope();
}
