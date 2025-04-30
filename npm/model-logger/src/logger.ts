// *****************************************************************************
// Copyright (C) 2025 STMicroelectronics.
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
import { Logger } from './types/logger';

const LOGGER_FACTORY = {
  getLogger: (name?: string): Logger => {
    return {
      error: (...messages: unknown[]) => {
        console.error(name ? `${name}:` : '', ...messages);
      },
      warn: (...messages: unknown[]) => {
        console.warn(name ? `${name}:` : '', ...messages);
      },
      info: (...messages: unknown[]) => {
        console.info(name ? `${name}:` : '', ...messages);
      },
      log: (...messages: unknown[]) => {
        console.log(name ? `${name}:` : '', ...messages);
      },
      debug: (...messages: unknown[]) => {
        console.debug(name ? `${name}:` : '', ...messages);
      },
    };
  },
};

const getLogger = (name?: string): Logger => {
  return LOGGER_FACTORY.getLogger(name);
};

export { getLogger, LOGGER_FACTORY };
