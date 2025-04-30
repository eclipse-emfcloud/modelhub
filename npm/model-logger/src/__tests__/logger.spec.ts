// *****************************************************************************
// Copyright (C) 2025 STMicroelectronics.
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

import { expect } from 'chai';
import sinon from 'sinon';
import { getLogger, LOGGER_FACTORY } from '../index';

describe('Logger', () => {
  let sandbox: sinon.SinonSandbox;
  let stubError: sinon.SinonStub;
  let stubWarn: sinon.SinonStub;
  let stubInfo: sinon.SinonStub;
  let stubLog: sinon.SinonStub;
  let stubDebug: sinon.SinonStub;

  describe('getLogger', () => {
    beforeEach(() => {
      sandbox = sinon.createSandbox();
      stubError = sandbox.stub(console, 'error');
      stubWarn = sandbox.stub(console, 'warn');
      stubInfo = sandbox.stub(console, 'info');
      stubLog = sandbox.stub(console, 'log');
      stubDebug = sandbox.stub(console, 'debug');
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('should log error messages', () => {
      const logger = getLogger('TestLogger');
      logger.error('This is an error message', 'And another error message');
      expect(
        stubError.calledWith(
          'TestLogger:',
          'This is an error message',
          'And another error message'
        )
      ).to.be.true;
    });

    it('should log warning messages', () => {
      const logger = getLogger('TestLogger');
      logger.warn('This is a warning message', 'And another warning message');
      expect(
        stubWarn.calledWith(
          'TestLogger:',
          'This is a warning message',
          'And another warning message'
        )
      ).to.be.true;
    });

    it('should log info messages', () => {
      const logger = getLogger('TestLogger');
      logger.info('This is an info message', 'And another info message');
      expect(
        stubInfo.calledWith(
          'TestLogger:',
          'This is an info message',
          'And another info message'
        )
      ).to.be.true;
    });

    it('should log log messages', () => {
      const logger = getLogger('TestLogger');
      logger.log('This is a log message', 'And another log message');
      expect(
        stubLog.calledWith(
          'TestLogger:',
          'This is a log message',
          'And another log message'
        )
      ).to.be.true;
    });

    it('should log debug messages', () => {
      const logger = getLogger('TestLogger');
      logger.debug('This is a debug message', 'And another debug message');
      expect(
        stubDebug.calledWith(
          'TestLogger:',
          'This is a debug message',
          'And another debug message'
        )
      ).to.be.true;
    });

    it('should log messages without a logger name', () => {
      const logger = getLogger();
      logger.log(
        'This is a log message without a logger name',
        'And another log message without a logger name'
      );
      expect(
        stubLog.calledWith(
          '',
          'This is a log message without a logger name',
          'And another log message without a logger name'
        )
      ).to.be.true;
    });

    it('should log error messages without a logger name', () => {
      const logger = getLogger();
      logger.error(
        'This is an error message without a logger name',
        'And another error message without a logger name'
      );
      expect(
        stubError.calledWith(
          '',
          'This is an error message without a logger name',
          'And another error message without a logger name'
        )
      ).to.be.true;
    });

    it('should log warning messages without a logger name', () => {
      const logger = getLogger();
      logger.warn(
        'This is a warning message without a logger name',
        'And another warning message without a logger name'
      );
      expect(
        stubWarn.calledWith(
          '',
          'This is a warning message without a logger name',
          'And another warning message without a logger name'
        )
      ).to.be.true;
    });

    it('should log info messages without a logger name', () => {
      const logger = getLogger();
      logger.info(
        'This is an info message without a logger name',
        'And another info message without a logger name'
      );
      expect(
        stubInfo.calledWith(
          '',
          'This is an info message without a logger name',
          'And another info message without a logger name'
        )
      ).to.be.true;
    });

    it('should log debug messages without a logger name', () => {
      const logger = getLogger();
      logger.debug(
        'This is a debug message without a logger name',
        'And another debug message without a logger name'
      );
      expect(
        stubDebug.calledWith(
          '',
          'This is a debug message without a logger name',
          'And another debug message without a logger name'
        )
      ).to.be.true;
    });
  });

  describe('Logger Fctory', () => {
    beforeEach(() => {
      sandbox = sinon.createSandbox();
      stubError = sandbox.stub(console, 'error');
      stubWarn = sandbox.stub(console, 'warn');
      stubInfo = sandbox.stub(console, 'info');
      stubLog = sandbox.stub(console, 'log');
      stubDebug = sandbox.stub(console, 'debug');
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('should log error messages', () => {
      const logger = LOGGER_FACTORY.getLogger('TestLogger');
      logger.error('This is an error message');
      expect(stubError.calledWith('TestLogger:', 'This is an error message')).to
        .be.true;
    });

    it('should log warning messages', () => {
      const logger = LOGGER_FACTORY.getLogger('TestLogger');
      logger.warn('This is a warning message');
      expect(stubWarn.calledWith('TestLogger:', 'This is a warning message')).to
        .be.true;
    });

    it('should log info messages', () => {
      const logger = LOGGER_FACTORY.getLogger('TestLogger');
      logger.info('This is an info message');
      expect(stubInfo.calledWith('TestLogger:', 'This is an info message')).to
        .be.true;
    });

    it('should log log messages', () => {
      const logger = LOGGER_FACTORY.getLogger('TestLogger');
      logger.log('This is a log message');
      expect(stubLog.calledWith('TestLogger:', 'This is a log message')).to.be
        .true;
    });

    it('should log debug messages', () => {
      const logger = LOGGER_FACTORY.getLogger('TestLogger');
      logger.debug('This is a debug message');
      expect(stubDebug.calledWith('TestLogger:', 'This is a debug message')).to
        .be.true;
    });

    it('should log messages without a logger name', () => {
      const logger = LOGGER_FACTORY.getLogger();
      logger.log('This is a log message without a logger name');
      expect(
        stubLog.calledWith('', 'This is a log message without a logger name')
      ).to.be.true;
    });
  });
});
