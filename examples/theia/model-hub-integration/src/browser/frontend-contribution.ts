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
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { FrontendApplicationStateService } from '@theia/core/lib/browser/frontend-application-state';
import { Deferred } from '@theia/core/lib/common/promise-util';
import { inject, injectable } from '@theia/core/shared/inversify';

const _appReady = new Deferred<boolean>();
export const appReady = _appReady.promise;

@injectable()
export class ExampleAppContribution implements FrontendApplicationContribution {
  @inject(FrontendApplicationStateService)
  protected readonly applicationStateService: FrontendApplicationStateService;

  async onStart(): Promise<void> {
    this.applicationStateService
      .reachedState('attached_shell')
      .then(() => _appReady.resolve(true));
  }
}
