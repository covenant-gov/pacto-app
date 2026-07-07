import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';
import { dmLog, dmWarn, dmError } from './dm-debug';

describe('dm-debug loggers', () => {
  let logSpy: MockInstance<typeof console.log>;
  let warnSpy: MockInstance<typeof console.warn>;
  let errorSpy: MockInstance<typeof console.error>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('dmLog logs only when DEV is true', () => {
    vi.stubEnv('DEV', true);
    dmLog('hello', 1);
    expect(logSpy).toHaveBeenCalledWith('[DM]', 'hello', 1);

    logSpy.mockClear();
    vi.stubEnv('DEV', false);
    dmLog('hello', 1);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('dmWarn warns only when DEV is true', () => {
    vi.stubEnv('DEV', true);
    dmWarn('warn', 2);
    expect(warnSpy).toHaveBeenCalledWith('[DM]', 'warn', 2);

    warnSpy.mockClear();
    vi.stubEnv('DEV', false);
    dmWarn('warn', 2);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('dmError always logs', () => {
    vi.stubEnv('DEV', false);
    dmError('error', 3);
    expect(errorSpy).toHaveBeenCalledWith('[DM]', 'error', 3);
  });
});
