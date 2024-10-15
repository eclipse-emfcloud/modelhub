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
import {
  FrontendModelAccessorBusSubscriber,
  FrontendModelAccessorBusSubscriberImpl,
} from '../frontend-model-accessor-bus-subscriber';
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

describe('FrontendModelAccessorBusSubscriber', () => {
  const appContext = 'test-app';

  let sandbox: sinon.SinonSandbox;
  let fake: FakeModelAccessorBusProtocol;
  let subscriber: FrontendModelAccessorBusSubscriberImpl;
  let onAccessorChanged: sinon.SinonStub;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    const container = createTestContainer();
    subscriber = container.get<FrontendModelAccessorBusSubscriberImpl>(
      FrontendModelAccessorBusSubscriber
    );

    fake = container.get(FakeModelAccessorBusProtocol);
    connectClient(fake, subscriber);
    onAccessorChanged = sinon.stub();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('subscribe', async () => {
    expect(
      await subscriber.subscribe(
        appContext,
        'fake-provider.get',
        onAccessorChanged
      )
    ).to.be.eql({
      id: 1,
      accessorId: 'fake-provider.get',
    });
  });

  it('unsubscribe', async () => {
    const token = await subscriber.subscribe(
      appContext,
      'fake-provider.get',
      onAccessorChanged
    );
    expect(() => subscriber.unsubscribe(token.id)).not.to.throw();
  });

  it('unsubscribe an already closed subscription', async () => {
    const token = await subscriber.subscribe(
      appContext,
      'fake-provider.get',
      onAccessorChanged
    );
    const subscription = subscriber
      .getSubscriptions()
      .find((sub) => sub.id === token.id);

    subscriber.unsubscribe(token.id);
    expect(subscription?.close()).to.be.false;
  });

  it('close from client', async () => {
    const token = await subscriber.subscribe(
      appContext,
      'fake-provider.get',
      onAccessorChanged
    );
    const spy = sinon.spy(subscriber, 'unsubscribe');
    subscriber.client.closeSubscription(token.id);
    expect(spy.calledWith(token.id)).to.be.true;
  });

  it('trigger onAccessorChanged', async () => {
    const token = await subscriber.subscribe(
      appContext,
      'fake-provider.get',
      onAccessorChanged
    );
    subscriber.client.onAccessorChanged(token.id);
    expect(onAccessorChanged.calledWith('fake-provider.get')).to.be.true;
  });

  it('getSubscriptions', async () => {
    const token = await subscriber.subscribe(
      appContext,
      'fake-provider.get',
      onAccessorChanged
    );
    expect(
      subscriber.getSubscriptions().findIndex((s) => s.id === token.id)
    ).to.be.gte(0);
  });
});
