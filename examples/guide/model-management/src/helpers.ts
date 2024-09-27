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

import util from 'util';

export function inspect(model: unknown) {
  return util.inspect(model, { showHidden: false, depth: null, colors: true });
}

export async function afterAsyncs(action: () => unknown) {
  await new Promise((resolve) => setImmediate(resolve, 0));
  action();
}

export function lastSegment(jsonPointer: string) {
  const lastSep = jsonPointer.lastIndexOf('/');
  return lastSep >= 0 ? jsonPointer.substring(lastSep + 1) : jsonPointer;
}

export function upToLastSegment(jsonPointer: string) {
  const lastSep = jsonPointer.lastIndexOf('/');
  return lastSep >= 0 ? jsonPointer.substring(0, lastSep) : jsonPointer;
}
