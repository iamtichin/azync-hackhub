import { trustProxyHops } from './trust-proxy';

describe('trustProxyHops', () => {
  it('does not trust forwarded addresses by default', () => expect(trustProxyHops(undefined)).toBe(0));
  it('allows an explicitly bounded proxy count', () => expect(trustProxyHops('1')).toBe(1));
  it('rejects invalid proxy configuration', () => {
    expect(() => trustProxyHops('-1')).toThrow();
    expect(() => trustProxyHops('forwarded')).toThrow();
    expect(() => trustProxyHops('11')).toThrow();
  });
});
