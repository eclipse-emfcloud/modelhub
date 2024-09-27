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
import { ModelB } from '@eclipse-emfcloud-example/model-b-api';
import {
  ModelBInternalAPI,
  ModelUpdateAction,
} from '@eclipse-emfcloud-example/model-b-model-service/lib/common';
import {
  ModelFormWidget,
  ModelFormWidgetOptions,
  ValidationStatus,
} from '@eclipse-emfcloud-example/model-hub-integration/lib/browser/model-form-widget';
import { severityComparator } from '@eclipse-emfcloud/model-validation';
import { Message } from '@theia/core/lib/browser';
import { inject, injectable } from '@theia/core/shared/inversify';
import { cloneDeep, eq, set } from 'lodash';
import * as React from 'react';

@injectable()
export class ModelBWidget extends ModelFormWidget<ModelB> {
  static readonly ID = 'model-b-widget';
  static readonly LABEL = 'Model B View';
  private modelAFirstName: string;

  @inject(ModelBInternalAPI)
  private readonly internalAPI: ModelBInternalAPI;

  constructor(
    @inject(ModelFormWidgetOptions)
    options: ModelFormWidgetOptions
  ) {
    super(options);
  }

  protected async doInit(): Promise<void> {
    // Connect to frontend model accessor bus to get ModelA firstName updates.
    // For demonstrative purpose, the accessorId is hard-coded
    const accessorId = 'firstName.get';
    const mab = this.modelHub.getModelAccessorBus();
    // Initialize value.
    this.modelAFirstName = (await mab.get(accessorId)) ?? '';
    // Subscribe to changes.
    await mab.subscribe(accessorId, async (id) => {
      const firstName = (await mab.get<string>(id)) ?? '';
      if (this.modelAFirstName !== firstName) {
        this.modelAFirstName = firstName;
        this.update();
      }
    });

    this.update();
  }

  render(): React.ReactNode {
    return (
      <div id="ModelBWidget-container">
        {this.model ? (
          <FormModelB
            modelURI={this.modelURI}
            model={this.model}
            internalAPI={this.internalAPI}
            validationStatus={this.validationStatus}
            modelAFirstName={this.modelAFirstName}
          />
        ) : (
          <div>Loading ...</div>
        )}
      </div>
    );
  }

  protected onAfterDetach(msg: Message): void {
    super.onAfterDetach(msg);
    this.internalAPI.unloadModel(this.modelURI);
  }
}

type FormModelBProps = {
  modelURI: string;
  model: ModelB;
  internalAPI: ModelBInternalAPI;
  validationStatus: ValidationStatus[];
  modelAFirstName: string;
};

export const FormModelB: React.FC<FormModelBProps> = (props) => {
  const [formModel, setFormModel] = React.useState<ModelB>(props.model);
  React.useEffect(() => setFormModel(props.model), [props.model]);
  const validity = new Map();

  props.validationStatus.forEach((status) => {
    const registeredStatus = validity.get(status.path);
    if (
      registeredStatus &&
      severityComparator(registeredStatus.severity, status.severity) >= 0
    ) {
      return;
    }
    validity.set(status.path, status);
  });

  const handleChange: React.ChangeEventHandler<HTMLInputElement> = (event) => {
    const key = event.target.name as keyof ModelB;
    const value =
      event.target.type === 'number'
        ? event.target.valueAsNumber
        : event.target.value;
    const newFormModel = cloneDeep(formModel);
    set(newFormModel, key, value);
    setFormModel(newFormModel);
  };
  const handleBlur: React.FocusEventHandler<HTMLInputElement> = (event) => {
    const key = event.target.name as keyof ModelB;
    if (!eq(formModel[key], props.model[key])) {
      const action: ModelUpdateAction = !formModel[key]
        ? { type: 'unset', key }
        : { type: 'set', key, value: formModel[key] };
      // Use a command stack identified by my widget ID
      props.internalAPI.updateModel(props.modelURI, ModelBWidget.ID, action);
    }
  };

  return (
    <form>
      <label>
        FooB
        <input
          className={`ModelBWidget-input ${validity.get('/fooB')?.severity}`}
          name="fooB"
          type="string"
          value={formModel.fooB ?? ''}
          onChange={handleChange}
          onBlur={handleBlur}
        ></input>
        <div className="ModelBWidget-validation">
          {validity.get('/fooB')?.message}
        </div>
      </label>
      <label>
        Length of fooB
        <input
          className={`ModelBWidget-input ${
            validity.get('/lengthOfFooB')?.severity
          }`}
          name="lengthOfFooB"
          type="number"
          value={formModel.lengthOfFooB ?? 0}
          readOnly={true}
        ></input>
        <div className="ModelBWidget-validation">
          {validity.get('/lengthOfFooB')?.message}
        </div>
      </label>
      <label>
        Number 1
        <input
          className={`ModelBWidget-input ${validity.get('/number1')?.severity}`}
          name="number1"
          type="number"
          value={formModel.number1 ?? 0}
          onChange={handleChange}
          onBlur={handleBlur}
        ></input>
        <div className="ModelBWidget-validation">
          {validity.get('/number1')?.message}
        </div>
      </label>
      <label>
        Number 2
        <input
          className={`ModelBWidget-input ${validity.get('/number2')?.severity}`}
          name="number2"
          type="number"
          value={formModel.number2 ?? 0}
          onChange={handleChange}
          onBlur={handleBlur}
        ></input>
        <div className="ModelBWidget-validation">
          {validity.get('/number2')?.message}
        </div>
      </label>
      <label>
        Full Name
        <input
          className={`ModelBWidget-input ${validity.get('/name')?.severity}`}
          name="name"
          type="string"
          value={formModel.name ?? ''}
          readOnly={true}
        ></input>
        <div className="ModelBWidget-validation">
          {validity.get('/name')?.message}
        </div>
      </label>
      <label>
        First Name
        <input
          className={`ModelBWidget-input`}
          name="firstName"
          type="string"
          value={props.modelAFirstName}
          readOnly={true}
        ></input>
      </label>
      <label>
        Is the Sum Even?
        <div className="ModelBWidget-evenSum">
          {formModel.evenSum ? 'YES' : 'NO'}
        </div>
        <div className="ModelBWidget-validation">
          {validity.get('/evenSum')?.message}
        </div>
      </label>
    </form>
  );
};
