# eclipse-emfcloud_modelhub

## Model Management

A generic Typescript based model management framework.

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
