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
export const SimpleModelProjectService = Symbol('SimpleModelProjectService');
export const SIMPLE_MODEL_PROJECT_SERVICE_PATH =
  '/services/eclipse-emfcloud-example/simple-model-project-service';

export interface SimpleModelProjectService {
  addProject(description: string): Promise<void>;
  removeProject(description: string): Promise<void>;
}
