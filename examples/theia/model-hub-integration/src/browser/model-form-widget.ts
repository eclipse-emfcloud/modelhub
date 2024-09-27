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
import {
  FrontendModelHub,
  FrontendModelHubProvider,
} from '@eclipse-emfcloud/model-service-theia/lib/browser';
import { Diagnostic, Severity, ok } from '@eclipse-emfcloud/model-validation';
import { Disposable, Emitter, ILogger } from '@theia/core';
import { Message, Saveable, Widget } from '@theia/core/lib/browser';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import {
  inject,
  injectable,
  postConstruct,
  unmanaged,
} from '@theia/core/shared/inversify';
import { cloneDeep } from 'lodash';
import { getApplicationProjectURI } from '../common/util';
import { appReady } from './frontend-contribution';

export const ModelFormWidgetOptions = Symbol('ModelFormWidgetOptions');
export interface ModelFormWidgetOptions extends Widget.IOptions {
  modelURI: string;
  id: string;
  title: string;
}

export type ValidationStatus = {
  severity: Severity;
  path: string;
  message: string;
};

@injectable()
export abstract class ModelFormWidget<M extends NonNullable<object>>
  extends ReactWidget
  implements Saveable
{
  @inject(FrontendModelHubProvider)
  private readonly modelHubProvider: FrontendModelHubProvider<string>;
  @inject(ILogger)
  protected readonly logger: ILogger;

  private _dirty = false;
  private dirtyChangedEmitter = new Emitter<void>();
  readonly onDirtyChanged = this.dirtyChangedEmitter.event;
  readonly autoSave = 'off';

  protected modelHub: FrontendModelHub<string>;
  protected model: M;
  protected validationStatus: ValidationStatus[] = [];

  constructor(
    @unmanaged()
    protected readonly options: ModelFormWidgetOptions
  ) {
    super(options);
  }

  @postConstruct()
  protected init(): void {
    this.id = this.options.id;
    this.title.label = this.options.title;
    this.title.caption = this.options.title;
    this.title.closable = true;
    this.title.iconClass = 'fa fa-window-maximize'; // example widget icon.
    this.node.tabIndex = 0;

    appReady
      .then(async () => {
        const appUri = getApplicationProjectURI(this.modelURI);
        this.modelHub = await this.modelHubProvider(appUri);
        this.model = await this.modelHub.getModel(this.modelURI);

        const diagnostic =
          (await this.modelHub.getValidationState(this.modelURI)) ?? ok();
        this.setValidationStatus(diagnostic);

        const modelSub = await this.modelHub.subscribe(this.modelURI);
        this.toDispose.push(Disposable.create(modelSub.close.bind(modelSub)));

        modelSub.onModelChanged = (modelID, model: M) => {
          if (modelID === this.modelURI) {
            // The model is cached locally and patched, so clone it
            // that React will see a new object
            this.model = cloneDeep(model);
            this.update();
          }
        };
        modelSub.onModelValidated = (modelID, _model, diagnostic) => {
          if (modelID === this.modelURI) {
            this.setValidationStatus(diagnostic);
            this.update();
          }
        };
        modelSub.onModelDirtyState = (modelID, _model, dirty) => {
          if (modelID === this.modelURI) {
            this._dirty = dirty;
            this.dirtyChangedEmitter.fire();
          }
        };
        modelSub.onModelUnloaded = this.dispose.bind(this);
      })
      .then(() => this.doInit())
      .catch((e) => this.logger.error(e));
  }

  protected async doInit(): Promise<void> {
    this.update();
  }

  get modelURI(): string {
    return this.options.modelURI;
  }

  get dirty(): boolean {
    return this._dirty;
  }

  async save(): Promise<void> {
    // Save all models because we have uneditable dependencies in the other model
    // that do not appear on its undo history
    return this.modelHub.save().then();
  }

  protected override onActivateRequest(msg: Message): void {
    super.onActivateRequest(msg);
    this.node.focus();
  }

  protected setValidationStatus(diagnostic: Diagnostic): void {
    if (!diagnostic.children || diagnostic.children.length === 0) {
      const { severity, message, path } = diagnostic;
      this.validationStatus = [{ severity, message, path }];
    } else {
      this.validationStatus = diagnostic.children.map(
        ({ severity, message, path }) => {
          return { severity, message, path };
        }
      );
    }
  }
}
