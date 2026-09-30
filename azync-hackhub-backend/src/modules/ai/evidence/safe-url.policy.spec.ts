import {
  assertSafePublicUrl,
  isBlockedIp,
  resolveSafePublicUrl,
} from './safe-url.policy';

describe('safe URL policy', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '192.168.1.1',
    '::1',
    '::ffff:10.0.0.1',
    'fd00::1',
  ])('blocks private or local address %s', (address) =>
    expect(isBlockedIp(address)).toBe(true),
  );

  it.each([
    'http://localhost/admin',
    'http://127.0.0.1/',
    'http://169.254.169.254/latest/meta-data',
    'https://user:pass@example.com/',
    'https://example.com:8443/',
  ])('rejects unsafe URL %s', async (url) => {
    await expect(assertSafePublicUrl(url)).rejects.toThrow();
  });

  it('returns the vetted address so callers can pin the outbound connection', async () => {
    await expect(resolveSafePublicUrl('https://8.8.8.8/health')).resolves.toMatchObject({
      url: expect.any(URL),
      addresses: [{ address: '8.8.8.8', family: 4 }],
    });
  });
});
