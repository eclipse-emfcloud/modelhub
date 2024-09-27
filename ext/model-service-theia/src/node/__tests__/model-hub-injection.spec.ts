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

import { ModelHub } from '@eclipse-emfcloud/model-service';
import { Container, inject, injectable } from '@theia/core/shared/inversify';
import { expect } from 'chai';
import { ModelHubContext, ModelHub as ModelHubIdentifier } from '../../common';
import backendModule from '../backend-module';

describe('Model Hub Contextual Injection', () => {
  const appContext1 = { context: 'a' };
  const appContext2 = { context: 'b' };
  const appContext3 = { context: 'c' };

  const createContextContainer = (context: object) => {
    const child = container.createChild();
    child.bind(ModelHubContext).toConstantValue(context);
    return child;
  };

  let container: Container;

  beforeEach(() => {
    container = new Container();
    container.load(backendModule);
    container.bind(HasModelHub).toSelf();
  });

  it('one context, one hub', () => {
    const contextContainer = createContextContainer(appContext1);
    const hasModelHub = contextContainer.get(HasModelHub);

    expect(hasModelHub.hub).to.exist;
    expect(hasModelHub.hub).to.have.ownProperty('context', appContext1);
  });

  it('multiple contexts, multiple hubs', function () {
    for (const context of [appContext1, appContext2, appContext3]) {
      const contextContainer = createContextContainer(context);
      const hasModelHub = contextContainer.get(HasModelHub);

      expect(hasModelHub.hub).to.exist;
      expect(hasModelHub.hub).to.have.ownProperty('context', context);
    }
  });
});

@injectable()
class HasModelHub {
  @inject(ModelHubIdentifier) public readonly hub: ModelHub<string>;
}
