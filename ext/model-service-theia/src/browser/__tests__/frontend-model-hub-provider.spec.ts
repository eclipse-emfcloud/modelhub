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

import { Container, ContainerModule } from '@theia/core/shared/inversify';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import {
  FrontendModelHubImpl,
  FrontendModelHubProvider,
} from '../frontend-model-hub';
import { bindFrontendModelHubProvider } from '../frontend-model-hub-provider';
import { FrontendModelHubSubscriber } from '../frontend-model-hub-subscriber';
import { FakeModelHubProtocol, connectClient } from './fake-model-hub-protocol';
import { testModule } from './test-module';

chai.use(chaiAsPromised);

function createTestContainer(): Container {
  const container = new Container();

  container.load(
    testModule,
    new ContainerModule((bind, unbind) => {
      unbind(FrontendModelHubProvider);
      bindFrontendModelHubProvider(bind);
    })
  );

  return container;
}

const MODEL1_ID = 'test.model1';
const MODEL1 = { name: 'Model 1' };

describe('FrontendModelHubProvider', () => {
  const appContext = 'test-app';

  let fake: FakeModelHubProtocol;
  let subscriber: FrontendModelHubSubscriber;
  let modelHubProvider: FrontendModelHubProvider<string>;
  let bombFrontendModelHubImpl: () => void;

  beforeEach(async () => {
    const container = createTestContainer();
    subscriber = container.get<FrontendModelHubSubscriber>(
      FrontendModelHubSubscriber
    );
    modelHubProvider = container.get<FrontendModelHubProvider<string>>(
      FrontendModelHubProvider
    );

    fake = container.get(FakeModelHubProtocol);
    fake.setModel(MODEL1_ID, MODEL1);
    connectClient(fake, subscriber);

    bombFrontendModelHubImpl = () => {
      sinon
        .stub(
          FrontendModelHubImpl.prototype,
          'initialize' as unknown as keyof FrontendModelHubImpl
        )
        .callsFake(() => {
          throw new Error('Boom!');
        });
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  it('get model hub already available', async () => {
    fake.fakeModelHubCreated(appContext);

    const modelHub = await modelHubProvider(appContext);

    expect(modelHub).to.exist;
  });

  it('waits for hub to become available', async () => {
    setTimeout(() => fake.fakeModelHubCreated('random-context'), 25);
    setTimeout(() => fake.fakeModelHubCreated(appContext), 35);

    const modelHub = await modelHubProvider(appContext);

    expect(modelHub).to.exist;
  });

  it('handles exception in initialization', async () => {
    fake.fakeModelHubCreated(appContext);

    bombFrontendModelHubImpl();
    const modelHub = modelHubProvider(appContext);

    expect(modelHub).eventually.to.be.rejected;
  });

  it('handles exception in awaited initialization', async () => {
    const modelHub = modelHubProvider(appContext);
    bombFrontendModelHubImpl();

    fake.fakeModelHubCreated(appContext);

    expect(modelHub).eventually.to.be.rejected;
  });
});
