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

import { Container } from '@theia/core/shared/inversify';
import { expect } from 'chai';
import sinon from 'sinon';
import { FrontendModelAccessorBus } from '../frontend-model-accessor-bus';
import { FrontendModelAccessorBusSubscriber } from '../frontend-model-accessor-bus-subscriber';
import { FrontendModelHubProvider } from '../frontend-model-hub';
import {
  FakeModelAccessorBusProtocol,
  connectClient,
} from './fake-model-accessor-bus-protocol';
import { testModule } from './test-module';

function createTestContainer(): Container {
  const container = new Container();
  container.load(testModule);
  return container;
}

describe('FrontendModelAccessorBus', () => {
  const appContext = 'test-app';

  let sandbox: sinon.SinonSandbox;
  let frontendModelAccessorBus: FrontendModelAccessorBus;
  let fake: FakeModelAccessorBusProtocol;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    const container = createTestContainer();
    const modelHub = await container.get<FrontendModelHubProvider>(
      FrontendModelHubProvider
    )(appContext);
    frontendModelAccessorBus = modelHub.getModelAccessorBus();
    const subscriber = container.get<FrontendModelAccessorBusSubscriber>(
      FrontendModelAccessorBusSubscriber
    );
    fake = container.get(FakeModelAccessorBusProtocol);
    connectClient(fake, subscriber);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('Call ModelAccessorBusProtocol', () => {
    it('get: expects the first parameter given (or undefined if none given)', async () => {
      expect(
        await frontendModelAccessorBus.get('test'),
        'Get should be undefined'
      ).to.be.undefined;
      expect(
        await frontendModelAccessorBus.get('test', ''),
        'Get should be an empty string'
      ).to.be.equal('');
    });
  });

  describe('Delegators to FrontendModelAccessorBusSubscriber', () => {
    it('subscribe', async () => {
      expect(
        await frontendModelAccessorBus.subscribe('test', () =>
          console.info('test')
        )
      ).to.be.eql({
        id: 1,
        accessorId: 'test',
      });
    });

    it('unsubscribe', async () => {
      expect(() => frontendModelAccessorBus.unsubscribe(1)).not.to.throw();
    });
  });
});
