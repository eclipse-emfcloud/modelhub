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

/**
 * Protocol for a subscription to the backend model hub tracking service.
 */
export interface ModelHubTrackingSubscription {
  /**
   * Optional notification when a model hub has been created in the
   * backend and is ready for service.
   *
   * @param context the model hub context
   */
  onModelHubCreated?: (context: string) => void;
  /**
   * Optional notification when a model hub has been destroyed in the
   * backend and is no longer available for service.
   *
   * @param context the model hub context
   */
  onModelHubDestroyed?: (context: string) => void;
  /**
   * Close the subscription.
   * After this call, the attached call-backs, if any, will
   * never be invoked by the tracking service.
   */
  close(): void;
}

export const ModelHubTracker = Symbol('ModelHubTracker');

/**
 * An injectable service for tracking the comings and goings of model hubs
 * in the backend. This tracking service is available both in the backend
 * and in the frontend.
 */
export interface ModelHubTracker {
  /**
   * Create a subscription by which to track backend model hubs.
   *
   * On attachment of an `onModelHubCreated()` call-back, that call-back
   * will be notified of the availability of all model hubs currently
   * in existence that are initialized and ready for service.
   */
  trackModelHubs(): ModelHubTrackingSubscription;
  /**
   * Query whether the backend has a model hub ready to serve the given `context`.
   *
   * @param context a model hub context
   * @returns whether the backend has a model hub ready to serve the `context`
   */
  isModelHubAvailable(context: string): boolean;
}
