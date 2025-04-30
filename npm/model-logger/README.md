# Model Logger

This module provides a flexible logging factory that allows both default console logging and custom logging implementations.

## Default behavior

The logger outputs messages to the console by default. To use the logger, import the `getLogger` function and create a logger instance with an optional name:

```typescript
import { getLogger } from '@eclipse-emfcloud/model-logger';

export class AddressBook {
  // Retrieve the logger
  logger = getLogger('AddressBook');

  addAddress = (newAddress: Address): boolean => {
    const addresses = this.getAddressBook();

    if (!addresses.find((address) => compareAddresses(address, newAddress))) {
      logger.debug('Adding a new address');
      // [AddressBook]: Adding a new address
      addresses.push(newAddress);
      return true;
    } else {
      logger.error('Trying to add an existing address');
      // [AddressBook]: Trying to add an existing address
    }

    return false;
  };
}
```

The logger supports five log levels similar to the standard Console interface methods: `log`, `error`, `debug`, `warn` and `info`.

## Override behavior

You can override the default logging behavior to implement custom logging strategies, such as logging to both console and file system.

To customize the logger, override the `LOGGER_FACTORY.getLogger` method with your implementation:

```typescript
// index.ts
import * as fs from 'fs';
import path from 'path';
import { LOGGER_FACTORY } from '@eclipse-emfcloud/model-logger';

const logFilePath = path.resolve(__dirname, 'logs.txt');

// User-specific logger
LOGGER_FACTORY.getLogger = (name?: string) => ({
  error: (...messages: unknown[]) => {
    console.error(name ? `${name}:` : '', ...messages);
    fs.appendFileSync(
      logFilePath,
      `[error${name ? ` - ${name}:` : ''}]: ${messages.join(' ')}\n`
    );
  },
  warn: (...messages: unknown[]) => {
    console.warn(name ? `${name}:` : '', ...messages);
    fs.appendFileSync(
      logFilePath,
      `[warn${name ? ` - ${name}:` : ''}]: ${messages.join(' ')}\n`
    );
  },
  info: (...messages: unknown[]) => {
    console.info(name ? `${name}:` : '', ...messages);
    fs.appendFileSync(
      logFilePath,
      `[info${name ? ` - ${name}:` : ''}]: ${messages.join(' ')}\n`
    );
  },
  log: (...messages: unknown[]) => {
    console.log(name ? `${name}:` : '', ...messages);
    fs.appendFileSync(
      logFilePath,
      `[log${name ? ` - ${name}:` : ''}]: ${messages.join(' ')}\n`
    );
  },
  debug: (...messages: unknown[]) => {
    console.debug(name ? `${name}:` : '', ...messages);
    fs.appendFileSync(
      logFilePath,
      `[debug${name ? ` - ${name}:` : ''}]: ${messages.join(' ')}\n`
    );
  },
});
```

After overriding the factory, all subsequent calls to `getLogger()` will return your custom implementation while maintaining the named logger functionality.
