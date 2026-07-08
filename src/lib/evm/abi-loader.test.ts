import { describe, expect, it } from 'vitest';
import {
  listShippedAbiRefs,
  loadShippedAbi,
  parseAbiJson,
  resolveAbiRefFromInfraPayload,
} from './abi-loader';

describe('abi-loader', () => {
  it('lists shipped abis', () => {
    const refs = listShippedAbiRefs();
    expect(refs.some((r) => r.ref === 'erc20-minimal')).toBe(true);
  });

  it('loads erc20 minimal abi', () => {
    const abi = loadShippedAbi('erc20-minimal');
    expect(Array.isArray(abi)).toBe(true);
    expect(abi?.some((e) => e.type === 'function' && e.name === 'balanceOf')).toBe(true);
  });

  it('returns null for an unknown shipped abi ref', () => {
    expect(loadShippedAbi('does-not-exist')).toBeNull();
  });

  it('trims whitespace from abi refs', () => {
    expect(loadShippedAbi('  erc20-minimal  ')).toBeTruthy();
  });

  it('parses array and foundry artifact', () => {
    const arr = parseAbiJson('[{"type":"function","name":"foo","inputs":[],"outputs":[]}]');
    expect(arr).toHaveLength(1);
    const artifact = parseAbiJson('{"abi":[{"type":"function","name":"bar","inputs":[],"outputs":[]}]}');
    expect(artifact).toHaveLength(1);
  });

  it('throws on empty ABI input', () => {
    expect(() => parseAbiJson('  ')).toThrow('Paste a JSON ABI array');
  });

  it('throws on non-array, non-artifact JSON', () => {
    expect(() => parseAbiJson('{"name":"foo"}')).toThrow('ABI JSON must be an array');
  });

  it('throws on malformed JSON', () => {
    expect(() => parseAbiJson('{invalid')).toThrow();
  });

  it('reads optional infra abiRef hook', () => {
    expect(resolveAbiRefFromInfraPayload({ custom_module: { abiRef: 'erc20-minimal' } })).toBe(
      'erc20-minimal',
    );
    expect(resolveAbiRefFromInfraPayload({})).toBeNull();
  });

  it('returns null for invalid infra payloads', () => {
    expect(resolveAbiRefFromInfraPayload(null)).toBeNull();
    expect(resolveAbiRefFromInfraPayload(undefined)).toBeNull();
    expect(resolveAbiRefFromInfraPayload('string')).toBeNull();
    expect(resolveAbiRefFromInfraPayload({ custom_module: null })).toBeNull();
    expect(resolveAbiRefFromInfraPayload({ custom_module: { abiRef: 123 } })).toBeNull();
    expect(resolveAbiRefFromInfraPayload({ custom_module: { abiRef: '   ' } })).toBeNull();
  });
});

