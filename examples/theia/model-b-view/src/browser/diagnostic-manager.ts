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

import { MODEL_B_MODEL_ID } from '@eclipse-emfcloud-example/model-b-api';
import { ModelBInternalAPIWatcher } from '@eclipse-emfcloud-example/model-b-model-service/lib/browser';
import { FrontendModelHubProvider } from '@eclipse-emfcloud/model-service-theia/lib/browser';
import { Diagnostic, ok } from '@eclipse-emfcloud/model-validation';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import URI from '@theia/core/lib/common/uri';
import { inject, injectable, optional } from '@theia/core/shared/inversify';
import { ProblemManager } from '@theia/markers/lib/browser/problem/problem-manager';
import {
  DiagnosticSeverity,
  Diagnostic as LangServerDiagnostic,
  Range,
} from 'vscode-languageserver-types';

@injectable()
export class DiagnosticManager implements FrontendApplicationContribution {
  @inject(ProblemManager)
  @optional()
  protected readonly problemManager?: ProblemManager;
  @inject(FrontendModelHubProvider)
  protected readonly modelHub: FrontendModelHubProvider<string>;
  @inject(ModelBInternalAPIWatcher)
  protected readonly internalAPIWatcher: ModelBInternalAPIWatcher;

  async initialize(): Promise<void> {
    this.internalAPIWatcher.onModelHubCreated(async ({ context, modelHub }) => {
      const modelUriPrefix = `${context}/${context.substring(
        context.lastIndexOf('/') + 1
      )}`;
      const modelURI = `${modelUriPrefix}.${MODEL_B_MODEL_ID}`;
      const initialDiag = (await modelHub.getValidationState(modelURI)) ?? ok();
      this.setProblemViewLeaf({
        diagnostic: initialDiag,
        modelURI,
      });
      const modelBSub = await modelHub.subscribe(modelURI);
      modelBSub.onModelValidated = (uri, _model, diagnostic) => {
        this.setProblemViewLeaf({ diagnostic, modelURI: uri });
      };
    });
  }

  private diagnosticToLangServerDiagnostic(
    diagnostic: Diagnostic
  ): LangServerDiagnostic | undefined {
    let severity: DiagnosticSeverity;
    switch (diagnostic.severity) {
      case 'ok':
        severity = DiagnosticSeverity.Hint;
        break;
      case 'info':
        severity = DiagnosticSeverity.Information;
        break;
      case 'warn':
        severity = DiagnosticSeverity.Warning;
        break;
      case 'error':
        severity = DiagnosticSeverity.Error;
        break;
      default:
        // this diagnostic should not be converted
        return undefined;
    }
    const range = Range.create(0, 0, 0, 0);
    const converted: LangServerDiagnostic = {
      ...diagnostic,
      range: range,
      severity: severity,
      relatedInformation: [],
    };
    return converted;
  }

  private setProblemViewLeaf({
    diagnostic,
    modelURI,
  }: {
    diagnostic: Diagnostic;
    modelURI: string;
  }): void {
    const converted = this.diagnosticToLangServerDiagnostic(diagnostic);
    if (!LangServerDiagnostic.is(converted)) {
      return;
    }
    if (converted.severity !== DiagnosticSeverity.Hint) {
      const converteds = [];
      if (diagnostic.children && diagnostic.children?.length > 0) {
        diagnostic.children.forEach((child) => {
          const childConverted = this.diagnosticToLangServerDiagnostic(child);
          if (childConverted) {
            converteds.push(childConverted);
          }
        });
      } else {
        converteds.push(converted);
      }
      this.problemManager?.setMarkers(
        new URI(modelURI),
        MODEL_B_MODEL_ID,
        converteds
      );
    } else {
      this.problemManager?.cleanAllMarkers(new URI(modelURI));
    }
  }
}
