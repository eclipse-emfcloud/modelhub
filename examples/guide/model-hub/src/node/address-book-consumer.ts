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
import { ModelHub as ModelHubIdentifier } from '@eclipse-emfcloud/model-service-theia/lib/common';
import { inject, injectable, interfaces } from '@theia/core/shared/inversify';
import { AddressBook, Project } from '../common';
import { SomeAddress } from './model-service-api';

export const ProjectManager = Symbol('ProjectManager');
export type ProjectManager = {
  getProjects(): Promise<Record<string, Project>>;
  getProject(name: string): Promise<Project>;
  getService<S>(
    project: Project,
    serviceIdentifier: interfaces.ServiceIdentifier<S>
  ): Promise<S>;
};

export const ProjectContainerFactory = Symbol('Factory<Project, Container>');
export type ProjectContainerFactory = (
  project: Project
) => interfaces.Container;

@injectable()
export class AddressBookConsumer {
  @inject(ProjectManager)
  protected readonly projectManager: ProjectManager;

  async getAddressesFor(
    project: Project,
    lastName: string,
    firstName: string
  ): Promise<SomeAddress[]> {
    const addressBook = await this.projectManager.getService(
      project,
      ProjectAddressBook
    );
    return addressBook.getAddressesFor(lastName, firstName);
  }
}

@injectable()
export class ProjectAddressBook {
  @inject(Project)
  protected readonly project: Project;

  @inject(ModelHubIdentifier)
  protected readonly modelHub: ModelHub;

  async getAddressesFor(
    lastName: string,
    firstName: string
  ): Promise<SomeAddress[]> {
    const contactsID = `/${this.project.name}/.settings/contacts.addressbook`;
    const addressBook = await this.modelHub.getModel<AddressBook>(contactsID);
    const entry = addressBook.entries.find(
      (e) => e.lastName === lastName && e.firstName === firstName
    );
    return entry ? ([...entry.addresses] as SomeAddress[]) : [];
  }
}

@injectable()
export class DefaultProjectManager implements ProjectManager {
  @inject(ProjectContainerFactory)
  private readonly getProjectContainer: ProjectContainerFactory;
  async getProjects(): Promise<Record<string, Project>> {
    // TODO: Implement this
    throw new Error('To be implemented.');
  }
  getProject(name: string): Promise<Project> {
    return this.getProjects().then((projects) => projects[name]);
  }
  async getService<S>(
    project: Project,
    serviceIdentifier: interfaces.ServiceIdentifier<S>
  ): Promise<S> {
    const container = this.getProjectContainer(project);
    return container.get(serviceIdentifier);
  }
}
