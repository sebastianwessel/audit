import { expect, test } from 'bun:test';

import { NoContentLogger } from './no-content-logger.js';

test('accepts harness logging calls without exposing fields through a child logger', () => {
  const logger = new NoContentLogger();
  const child = logger.child({ providerBody: 'must-not-be-emitted' });

  expect(child).toBe(logger);
  expect(() => {
    logger.trace('trace', { source: 'must-not-be-emitted' });
    logger.debug('debug', { source: 'must-not-be-emitted' });
    logger.info('info', { source: 'must-not-be-emitted' });
    logger.warn('warning', { source: 'must-not-be-emitted' });
    logger.error('error', { source: 'must-not-be-emitted' });
    logger.fatal('fatal', { source: 'must-not-be-emitted' });
  }).not.toThrow();
});
