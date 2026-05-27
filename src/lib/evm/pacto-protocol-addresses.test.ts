import { describe, expect, it } from 'vitest';
import { pactoProtocolNetworkBook } from './pacto-protocol-addresses';

describe('pacto-protocol-addresses', () => {
  it('loads Sepolia sponsor and gov factories from the book', () => {
    const sepolia = pactoProtocolNetworkBook('sepolia');
    expect(sepolia?.chainId).toBe(11155111);
    expect(sepolia?.squadSponsor?.factory).toBe('0x3994B38f9A0Cf542241FD9C959F94386e6733D6e');
    expect(sepolia?.pactoGov?.navePirataFactory).toBe('0x44E42cf7b2DadDe6D5fc27B57625EaF3e3D41316');
  });
});
