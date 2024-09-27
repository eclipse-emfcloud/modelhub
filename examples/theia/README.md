# Example application

The example application consists of a Theia application and is divided in 4 main parts:

-   the browser-app and electron-app Theia applications
-   the `model-hub-integration` Theia extension responsible for the Model Hub lifecycle
-   the Model A part is divided into 3 Theia extensions:
    -   the `model-a-view` part which contains the frontend part to display the Model A view,
    -   the `model-a-api` which contains the common shared types and interfaces for Model A's public API
    -   the `model-a-model-service` contribution which is injected into the `ModelHub` to be used to execute/undo/redo commands and subscribe to any model changes.
-   the modelB part is divided into 3 Theia extensions:
    -   the `model-b-view` part which contains the frontend part to display the Model B view,
    -   the `model-b-api` which contains the common shared types and interfaces for Model B's public API
    -   the `model-b-model-service` contribution which is injected into the `ModelHub` to be used to execute/undo/redo commands and subscribe to any model changes.

For the subscribe part:

-   the [Model A sum attribute](model-a-api/src/common/model-a-api.ts#L22) is the addition of the Model B `number1` and `number2` attributes,
-   the [Model B name attribute](model-b-api/src/common/model-b-api.ts#L21) is the concatenation of Model A `firstName` and `lastName` attributes.

## Running the example

To launch the example, run one of

-   `$ yarn start:examples:browser` for the browser deployment of the application, or
-   `$ yarn start:examples:electron` for the Electron deployment of the application

The application opens the example workspace located in the `workspace/` subdirectory of this module.
