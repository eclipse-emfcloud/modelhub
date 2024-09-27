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

import Chai, { assert, expect } from 'chai';
import Sinon from 'sinon';
import SinonChai from 'sinon-chai';
import {
  ProviderChangeListener,
  ProviderChangeSubscription,
} from '../change-subscription';
import { ModelAccessorBusImpl } from '../model-accessor-bus';
import { DefaultProvider } from '../provider';

Chai.use(SinonChai);

const mapped_signals = [
  {
    pin: 'A0',
    signal: 'USART1_TX',
  },
  {
    pin: 'C1',
    signal: 'SPI2_RX',
  },
];

const CLOCK_FREQ_ACCESSOR = 'clock.frequency';
const CLOCK_FREQ_CORE_ACCESSOR = 'clock.frequency.core';
const CLOCK_INPUT_ACCESSOR = 'clock.input';
const CLOCK_ALL_ACCESSORS = 'clock';
const PINOUT_SIGNALS_ACCESSOR = 'pinout.mapped-signals';
const CLOCK_FREQ_NOTIF_ID = 'frequency';
const CLOCK_FREQ_CORE_NOTIF_ID = 'frequency.core';
const CLOCK_INPUT_NOTIF_ID = 'input';
const PINOUT_SIGNALS_NOTIF_ID = 'mapped-signals';
const PINOUT_ALL_ACCESSORS = 'pinout';
const TEST_NESTED_PROPERTY = 'test.nested.prop';

const HSE_CLOCK_FREQUENCY = 4800000;

class PinoutProvider extends DefaultProvider {
  constructor() {
    super('pinout');
    this.accessors.set('mapped-signals', (..._parameters: unknown[]) => {
      return mapped_signals;
    });
  }
}

class ClockProvider extends DefaultProvider {
  constructor() {
    super('clock');
    this.accessors.set('frequency', this.getFrequency);
    this.accessors.set('input', this.getInput);
  }

  private getFrequency(clockId: string): number | undefined {
    if (clockId === 'HSE') {
      return HSE_CLOCK_FREQUENCY;
    }
    return undefined;
  }

  private getInput(instance: string): string | undefined {
    if (instance === 'USART4') {
      return 'HSE';
    }
    return undefined;
  }
}

class TestProvider extends DefaultProvider {
  constructor() {
    super('test');
    this.accessors.set('nested.prop', this.getNestedProp);
  }

  private getNestedProp(): string {
    return 'nested value';
  }
}

describe('ModelAccessorBusImpl', () => {
  let modelAccessorBus: ModelAccessorBusImpl;
  let pinoutProvider: PinoutProvider;
  let clockProvider: ClockProvider;
  let testProvider: TestProvider;
  let generalListener: ProviderChangeListener;
  let clockListener: ProviderChangeListener;
  let clockFrequencyListener: ProviderChangeListener;
  let clockFrequencyListener2: ProviderChangeListener;
  let clockFrequencyCoreListener: ProviderChangeListener;
  let clockInputListener: ProviderChangeListener;
  let pinoutListener: ProviderChangeListener;
  let pinoutMappedSignalListener: ProviderChangeListener;
  let generalSubscription: ProviderChangeSubscription;
  let clockSubscription: ProviderChangeSubscription;
  let clockInputSubscription: ProviderChangeSubscription;

  beforeEach(() => {
    modelAccessorBus = new ModelAccessorBusImpl();
    pinoutProvider = new PinoutProvider();
    clockProvider = new ClockProvider();
    testProvider = new TestProvider();

    // Register providers
    modelAccessorBus.register(pinoutProvider);
    modelAccessorBus.register(clockProvider);
    modelAccessorBus.register(testProvider);

    // Create subscriptions
    generalListener = Sinon.spy();
    generalSubscription = modelAccessorBus.subscribe('*', generalListener);
    clockListener = Sinon.spy();
    clockSubscription = modelAccessorBus.subscribe(
      CLOCK_ALL_ACCESSORS,
      clockListener
    );
    clockFrequencyListener = Sinon.spy();
    modelAccessorBus.subscribe(CLOCK_FREQ_ACCESSOR, clockFrequencyListener);
    clockFrequencyListener2 = Sinon.spy();
    modelAccessorBus.subscribe(CLOCK_FREQ_ACCESSOR, clockFrequencyListener2);
    clockFrequencyCoreListener = Sinon.spy();
    modelAccessorBus.subscribe(
      CLOCK_FREQ_CORE_ACCESSOR,
      clockFrequencyCoreListener
    );
    clockInputListener = Sinon.spy();
    clockInputSubscription = modelAccessorBus.subscribe(
      CLOCK_INPUT_ACCESSOR,
      clockInputListener
    );
    pinoutListener = Sinon.spy();
    modelAccessorBus.subscribe(PINOUT_ALL_ACCESSORS, pinoutListener);
    pinoutMappedSignalListener = Sinon.spy();
    modelAccessorBus.subscribe(
      PINOUT_SIGNALS_ACCESSOR,
      pinoutMappedSignalListener
    );
  });

  /**
   * Test for bus level features
   */
  describe('Bus', () => {
    /**
     * Calling an unknown accessors from a known provider does not break and only returns undefined
     */
    it('returns undefined when calling an unknown accessors from a known provider', () => {
      expect(modelAccessorBus.get('clock.bar')).to.be.undefined;
    });
    /**
     * Calling an unknown accessors from an unknown provider does not break and only returns undefined
     */
    it('returns undefined when calling an unknown accessors from an unknown provider', () => {
      expect(modelAccessorBus.get('foo.bar')).to.be.undefined;
    });
    /**
     * Unregistering an unknown provider does not raise exception
     */
    it('must not crash when unregistering an unknown provider', () => {
      try {
        modelAccessorBus.unregister('toto');
      } catch (e: unknown) {
        assert.fail(`Unexpected exception: ${e}`);
      }
    });

    /* Checking dispatching matrix: see ModelAccessorImpl.dispatchNotification comment */
    it('implements line 1 of notification dispatching matrix', () => {
      clockProvider.notify(); // All accessors
      expect(generalListener).callCount(1); // called
      clockProvider.notify(CLOCK_FREQ_NOTIF_ID);
      expect(generalListener).callCount(2); // called
      clockProvider.notify(CLOCK_FREQ_CORE_NOTIF_ID);
      expect(generalListener).callCount(3); // called
      clockProvider.notify(CLOCK_INPUT_NOTIF_ID);
      expect(generalListener).callCount(4); // called
      pinoutProvider.notify(); // All accessors
      expect(generalListener).callCount(5); // called
      pinoutProvider.notify(PINOUT_SIGNALS_NOTIF_ID); // All accessors
      expect(generalListener).callCount(6); // called
    });
    it('implements line 2 of notification dispatching matrix', () => {
      clockProvider.notify(); // All accessors
      expect(clockListener).callCount(1); // called
      clockProvider.notify(CLOCK_FREQ_NOTIF_ID);
      expect(clockListener).callCount(2); // called
      clockProvider.notify(CLOCK_FREQ_CORE_NOTIF_ID);
      expect(clockListener).callCount(3); // called
      clockProvider.notify(CLOCK_INPUT_NOTIF_ID);
      expect(clockListener).callCount(4); // called
      pinoutProvider.notify(); // All accessors
      expect(clockListener).callCount(4); // NOT called
      pinoutProvider.notify(PINOUT_SIGNALS_NOTIF_ID); // All accessors
      expect(clockListener).callCount(4); // NOT called
    });
    it('implements line 3 of notification dispatching matrix', () => {
      clockProvider.notify(); // All accessors
      expect(clockFrequencyListener).callCount(1); // called
      clockProvider.notify(CLOCK_FREQ_NOTIF_ID);
      expect(clockFrequencyListener).callCount(2); // called
      clockProvider.notify(CLOCK_FREQ_CORE_NOTIF_ID);
      expect(clockFrequencyListener).callCount(2); // NOT called
      clockProvider.notify(CLOCK_INPUT_NOTIF_ID);
      expect(clockFrequencyListener).callCount(2); // NOT called
      pinoutProvider.notify(); // All accessors
      expect(clockFrequencyListener).callCount(2); // NOT called
      pinoutProvider.notify(PINOUT_SIGNALS_NOTIF_ID); // All accessors
      expect(clockFrequencyListener).callCount(2); // NOT called
    });
    it('implements line 4 of notification dispatching matrix', () => {
      clockProvider.notify(); // All accessors
      expect(clockFrequencyCoreListener).callCount(1); // called
      clockProvider.notify(CLOCK_FREQ_NOTIF_ID);
      expect(clockFrequencyCoreListener).callCount(1); // NOT called
      clockProvider.notify(CLOCK_FREQ_CORE_NOTIF_ID);
      expect(clockFrequencyCoreListener).callCount(2); // called
      clockProvider.notify(CLOCK_INPUT_NOTIF_ID);
      expect(clockFrequencyCoreListener).callCount(2); // NOT called
      pinoutProvider.notify(); // All accessors
      expect(clockFrequencyCoreListener).callCount(2); // NOT called
      pinoutProvider.notify(PINOUT_SIGNALS_NOTIF_ID); // All accessors
      expect(clockFrequencyCoreListener).callCount(2); // NOT called
    });
    it('implements line 5 of notification dispatching matrix', () => {
      clockProvider.notify(); // All accessors
      expect(clockInputListener).callCount(1); // called
      clockProvider.notify(CLOCK_FREQ_NOTIF_ID);
      expect(clockInputListener).callCount(1); // NOT called
      clockProvider.notify(CLOCK_FREQ_CORE_NOTIF_ID);
      expect(clockInputListener).callCount(1); // NOT called
      clockProvider.notify(CLOCK_INPUT_NOTIF_ID);
      expect(clockInputListener).callCount(2); // called
      pinoutProvider.notify(); // All accessors
      expect(clockInputListener).callCount(2); // NOT called
      pinoutProvider.notify(PINOUT_SIGNALS_NOTIF_ID); // All accessors
      expect(clockInputListener).callCount(2); // NOT called
    });
    it('implements line 6 of notification dispatching matrix', () => {
      clockProvider.notify(); // All accessors
      expect(pinoutListener).callCount(0); // NOT called
      clockProvider.notify(CLOCK_FREQ_NOTIF_ID);
      expect(pinoutListener).callCount(0); // NOT called
      clockProvider.notify(CLOCK_FREQ_CORE_NOTIF_ID);
      expect(pinoutListener).callCount(0); // NOT called
      clockProvider.notify(CLOCK_INPUT_NOTIF_ID);
      expect(pinoutListener).callCount(0); // called
      pinoutProvider.notify(); // All accessors
      expect(pinoutListener).callCount(1); // called
      pinoutProvider.notify(PINOUT_SIGNALS_NOTIF_ID); // All accessors
      expect(pinoutListener).callCount(2); // called
    });
    it('implements line 7 of notification dispatching matrix', () => {
      clockProvider.notify(); // All accessors
      expect(pinoutMappedSignalListener).callCount(0); // NOT called
      clockProvider.notify(CLOCK_FREQ_NOTIF_ID);
      expect(pinoutMappedSignalListener).callCount(0); // NOT called
      clockProvider.notify(CLOCK_FREQ_CORE_NOTIF_ID);
      expect(pinoutMappedSignalListener).callCount(0); // NOT called
      clockProvider.notify(CLOCK_INPUT_NOTIF_ID);
      expect(pinoutMappedSignalListener).callCount(0); // called
      pinoutProvider.notify(); // All accessors
      expect(pinoutMappedSignalListener).callCount(1); // called
      pinoutProvider.notify(PINOUT_SIGNALS_NOTIF_ID); // All accessors
      expect(pinoutMappedSignalListener).callCount(2); // called
    });
  });

  /**
   * Test for bus accessors consumers features
   */
  describe('Consumer', () => {
    /**
     * Check that an no-parameter accessor is correctly called
     */
    it('calls an accessor without parameter', () => {
      const result = modelAccessorBus.get(PINOUT_SIGNALS_ACCESSOR);
      expect(result).to.be.deep.equal(mapped_signals);
    });
    /**
     * Check that an with-parameters accessor is correctly called with the provided arguments
     */
    it('calls an accessor with parameters', () => {
      const result = modelAccessorBus.get(CLOCK_FREQ_ACCESSOR, 'HSE');
      expect(result).to.be.equal(HSE_CLOCK_FREQUENCY);
    });
    /**
     * Check that a consumer listening to all accessors of all providers,
     * after being called, is not called by anyone.
     */
    it('unregister for notifications of all accessors of all providers', () => {
      generalSubscription.close();

      clockProvider.notify(); // All accessors
      clockProvider.notify(CLOCK_FREQ_NOTIF_ID);
      clockProvider.notify(CLOCK_INPUT_NOTIF_ID);

      expect(generalListener).callCount(0);
    });
    /**
     * Check that a consumer listening to all accessors of a provider,
     * after being called, is not called by anyone.
     */
    it('unregister for notifications of all accessors of a provider', () => {
      clockSubscription.close();

      clockProvider.notify(); // All accessors
      clockProvider.notify(CLOCK_FREQ_NOTIF_ID);
      clockProvider.notify(CLOCK_INPUT_NOTIF_ID);

      expect(clockListener).callCount(0);
    });
    /**
     * Check that closing a subscription registered on a single provider's accessor
     * does not prevent other subscriptions from being notified
     */
    it('unregister for notifications of a single accessor of a provider', () => {
      clockInputSubscription.close();

      clockProvider.notify(); // All accessors
      clockProvider.notify(CLOCK_FREQ_NOTIF_ID);
      clockProvider.notify(CLOCK_INPUT_NOTIF_ID);

      expect(clockInputListener).callCount(0);
      expect(clockFrequencyListener).callCount(2);
    });
    /**
     * Change that a subscription is not triggered by notifications out of its scope
     */
    it('is not notified about changes out of it scope of interest', () => {
      // From a provider on which it already listens to other accessors
      clockProvider.notify(CLOCK_FREQ_NOTIF_ID);

      expect(clockInputListener).callCount(0);

      // From a provider on which it does not listen to any accessor
      pinoutProvider.notify(PINOUT_SIGNALS_NOTIF_ID);

      expect(clockInputListener).callCount(0);
    });
    /**
     * Calling an accessor wildcard from a known provider does not break and only returns undefined
     */
    it('returns undefined when calling a wildcard accessors from a known provider', () => {
      expect(modelAccessorBus.get('clock.*')).to.be.undefined;
    });
    /**
     * Calling an accessor substring from a known provider does not break and only returns undefined
     */
    it('returns undefined when calling an accessor substring from a known provider', () => {
      expect(modelAccessorBus.get('clock.')).to.be.undefined;
    });
    /**
     * Calling an ambiguous accessor pattern from a known provider does not break and only returns undefined
     */
    it('returns undefined when calling an ambiguous accessor pattern from a known provider', () => {
      expect(modelAccessorBus.get('clockDriver')).to.be.undefined;
    });
    /**
     * Calling nested property (with more than 1 separator) should call the provider
     * with the correct accessor id
     */
    it('handle nested properties', () => {
      expect(modelAccessorBus.get(TEST_NESTED_PROPERTY)).to.be.equal(
        'nested value'
      );
    });
  });

  /**
   * Test for providers features
   */
  describe('Provider', () => {
    it('registers several accessors', () => {
      const accessors = modelAccessorBus.getAllAccessors();
      expect(accessors.length).to.be.equal(4);
      expect(accessors).to.be.have.members([
        PINOUT_SIGNALS_ACCESSOR,
        CLOCK_FREQ_ACCESSOR,
        CLOCK_INPUT_ACCESSOR,
        TEST_NESTED_PROPERTY,
      ]);
    });
    /**
     * Checks that unregistering a provider removes all its accessors from the list
     * and prevents him from notifying consumers
     */
    it('unregisters', () => {
      modelAccessorBus.unregister(clockProvider.id);
      const accessors = modelAccessorBus.getAllAccessors();
      expect(accessors.length).to.be.equal(2);
      expect(accessors).not.to.be.have.members([
        CLOCK_FREQ_ACCESSOR,
        CLOCK_INPUT_ACCESSOR,
      ]);
      clockProvider.notify(CLOCK_ALL_ACCESSORS);
      expect(clockListener).callCount(0);
      expect(clockInputListener).callCount(0);
      expect(clockFrequencyListener).callCount(0);
    });
    /**
     * Checks that a subscription onModelChange function is called
     * when a provider triggers consumers
     */
    it('notifies consumers with id', () => {
      clockProvider.notify(CLOCK_FREQ_NOTIF_ID);
      expect(clockFrequencyListener).calledOnceWith(CLOCK_FREQ_ACCESSOR);
      expect(clockFrequencyListener2).calledOnceWith(CLOCK_FREQ_ACCESSOR);
      expect(generalListener).calledOnceWith(CLOCK_FREQ_ACCESSOR);
    });
    it('notifies consumers without id', () => {
      clockProvider.notify();
      expect(clockFrequencyListener).calledOnceWith(CLOCK_ALL_ACCESSORS);
      expect(clockFrequencyListener2).calledOnceWith(CLOCK_ALL_ACCESSORS);
      expect(generalListener).calledOnceWith(CLOCK_ALL_ACCESSORS);
    });
  });
});
