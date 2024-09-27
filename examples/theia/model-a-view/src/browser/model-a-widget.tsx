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
import { ModelA } from '@eclipse-emfcloud-example/model-a-api';
import {
  ModelAInternalAPI,
  ModelUpdateAction,
} from '@eclipse-emfcloud-example/model-a-model-service/lib/common';
import {
  ModelFormWidget,
  ModelFormWidgetOptions,
} from '@eclipse-emfcloud-example/model-hub-integration/lib/browser/model-form-widget';
import { Message } from '@theia/core/lib/browser';
import { inject, injectable } from '@theia/core/shared/inversify';
import { cloneDeep, eq, set } from 'lodash';
import * as React from 'react';

@injectable()
export class ModelAWidget extends ModelFormWidget<ModelA> {
  static readonly ID = 'model-a-widget';
  static readonly LABEL = 'Model A View';

  @inject(ModelAInternalAPI)
  private readonly internalAPI: ModelAInternalAPI;

  constructor(
    @inject(ModelFormWidgetOptions)
    options: ModelFormWidgetOptions
  ) {
    super(options);
  }

  render(): React.ReactNode {
    return (
      <div id="ModelAWidget-container">
        {this.model ? (
          <FormModelA
            modelURI={this.modelURI}
            model={this.model}
            internalAPI={this.internalAPI}
          />
        ) : (
          <div>Loading ...</div>
        )}
      </div>
    );
  }

  protected override onActivateRequest(msg: Message): void {
    super.onActivateRequest(msg);
    this.node.focus();
  }

  protected onAfterDetach(msg: Message): void {
    super.onAfterDetach(msg);
    this.internalAPI.unloadModel(this.modelURI);
  }
}

type FormModelAProps = {
  modelURI: string;
  model: ModelA;
  internalAPI: ModelAInternalAPI;
};

export const FormModelA: React.FC<FormModelAProps> = (props) => {
  const [formModel, setFormModel] = React.useState<ModelA>(props.model);
  React.useEffect(() => setFormModel(props.model), [props.model]);

  const handleChange: React.ChangeEventHandler<HTMLInputElement> = (event) => {
    const key = event.target.name as keyof ModelA;
    const value =
      event.target.type === 'number'
        ? event.target.valueAsNumber
        : event.target.value;
    const newFormModel = cloneDeep(formModel);
    set(newFormModel, key, value);
    setFormModel(newFormModel);
  };
  const handleBlur: React.FocusEventHandler<HTMLInputElement> = (event) => {
    const key = event.target.name as keyof ModelA;
    if (!eq(formModel[key], props.model[key])) {
      const action: ModelUpdateAction = !formModel[key]
        ? { type: 'unset', key }
        : { type: 'set', key, value: formModel[key] };
      // Use a command stack identified by my widget ID
      props.internalAPI.updateModel(props.modelURI, ModelAWidget.ID, action);
    }
  };

  return (
    <form>
      <label>
        FooA
        <input
          className="ModelAWidget-input"
          name="fooA"
          type="string"
          value={formModel.fooA ?? ''}
          onChange={handleChange}
          onBlur={handleBlur}
        ></input>
        <div className="ModelAWidget-validation"></div>
      </label>
      <label>
        Length of fooA
        <input
          className="ModelAWidget-input"
          name="lengthOfFooA"
          type="number"
          value={formModel.lengthOfFooA ?? 0}
          readOnly={true}
        ></input>
        <div className="ModelAWidget-validation"></div>
      </label>
      <label>
        First Name
        <input
          className="ModelAWidget-input"
          name="firstName"
          type="string"
          value={formModel.firstName ?? ''}
          onChange={handleChange}
          onBlur={handleBlur}
        ></input>
        <div className="ModelAWidget-validation"></div>
      </label>
      <label>
        Last Name
        <input
          className="ModelAWidget-input"
          name="lastName"
          type="string"
          value={formModel.lastName ?? ''}
          onChange={handleChange}
          onBlur={handleBlur}
        ></input>
        <div className="ModelAWidget-validation"></div>
      </label>
      <label>
        Sum
        <input
          className="ModelAWidget-input"
          name="sum"
          type="string"
          value={formModel.sum ?? 0}
          readOnly={true}
        ></input>
        <div className="ModelAWidget-validation"></div>
      </label>
    </form>
  );
};
