# Eclipse EMF Cloud ModelHub [![build-CI](https://img.shields.io/github/actions/workflow/status/eclipse-emfcloud/modelhub/build-ci.yml?label=Build%20CI)](https://github.com/eclipse-emfcloud/modelhub/actions/workflows/build-ci.yml)

[![Aim - Framework](https://img.shields.io/badge/Aim-Framework-brightgreen)](https://github.com/eclipsesource/.github/blob/main/repository-classification.md)
[![Project - Active](https://img.shields.io/badge/Project-Active-2ea44f)](https://github.com/eclipsesource/.github/blob/main/repository-classification.md)
[![License: EPL v2.0](https://img.shields.io/badge/License-EPL%20v2.0-yellow.svg)](https://www.eclipse.org/legal/epl-2.0/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

This repository contains a framework. It is meant as a library or platform for implementing certain features or types of products, or can be used as a product directly. It is designed to be reusable, customizable, and ready for production.

This repository is under active development. The maintainers of this repository are actively developing new features and releasing new versions.

For more information, please visit the [EMF Cloud Website](https://www.eclipse.org/emfcloud/).

If you are interested in adopting this framework for your product or enhancing its feature spectrum, please get in contact with us using the [discussions forum](https://github.com/eclipse-emfcloud/emfcloud/discussions) and have a look at our [support options](https://www.eclipse.org/emfcloud/contact/)!

## Model Management

A generic Typescript based model management framework.

## Available via NPM [![publish-CI](https://img.shields.io/github/actions/workflow/status/eclipse-emfcloud/modelhub/publish-ci.yml?label=Publish%20CI)](https://github.com/eclipse-emfcloud/modelhub/actions/workflows/publish-ci.yml)

-   [`@eclipse-emfcloud/model-accessor-bus`](https://www.npmjs.com/package/@eclipse-emfcloud/model-accessor-bus)
-   [`@eclipse-emfcloud/model-manager`](https://www.npmjs.com/package/@eclipse-emfcloud/model-manager)
-   [`@eclipse-emfcloud/model-service-theia`](https://www.npmjs.com/package/@eclipse-emfcloud/model-service-theia)
-   [`@eclipse-emfcloud/model-service`](https://www.npmjs.com/package/@eclipse-emfcloud/model-service)
-   [`@eclipse-emfcloud/model-validation`](https://www.npmjs.com/package/@eclipse-emfcloud/model-validation)
-   [`@eclipse-emfcloud/trigger-engine`](https://www.npmjs.com/package/@eclipse-emfcloud/trigger-engine)

## Example application

A generic example application is provided [here](examples/theia) and can be used as bootstrap for any feature using Model Management.
The documentation can be found [here](examples/theia/README.md).

## Development

### User Guide

A comprehensive [user's guide][mmug] to development with the Model Management frameworks is available [here][mmug].

[mmug]: docs/guides/model-management-user-guide.md

### Prerequisites

-   Node `>= 18.0.0`
-   yarn `>= 1.7.0` _AND_ `< 2.0.0`

### Scripts

**Basic** setup

-   `yarn` to setup monorepo and transpile all packages. This does not build the example applications.

**Build** scripts

-   `yarn build` to transpile all packages and build example applications.
-   `yarn build:npm` to transpile npm packages.
-   `yarn build:examples` to transpile example packages and build example applications.

**Watch** script

-   `yarn run watch` to watch all packages including the example applications

**Start** example apps

-   `yarn browser start`
-   `yarn electron start`
-   `yarn electron start:validation`

Alternatively you can use the VS Code launch configurations.

_Remark:_ If the Electron example fails to start due to drivelist errors, the issue can often be resolved by running `git clean -fdx` and reinstalling all `node_modules` via `yarn`.

**Run** tests

-   `yarn test` to execute all tests
-   `yarn test:coverage` to execute all tests including coverage measurement

## License

This program and the accompanying materials are made available under the
terms of the Eclipse Public License v. 2.0 which is available at
<http://www.eclipse.org/legal/epl-2.0>.

This Source Code may also be made available under the following Secondary
Licenses when the conditions for such availability set forth in the Eclipse
Public License v. 2.0 are satisfied: MIT.

SPDX-License-Identifier: EPL-2.0 OR MIT
