import { isIP } from 'net';
import { resolve4, resolve6 } from 'dns/promises';

export interface ResolvedPublicUrl {
  url: URL;
  addresses: Array<{ address: string; family: 4 | 6 }>;
}

function isBlockedIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part)))
    return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0 && parts[2] === 113) ||
    a >= 224
  );
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized.startsWith('::ffff:')) {
    return isBlockedIpv4(normalized.slice('::ffff:'.length));
  }
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith('ff') ||
    normalized.startsWith('2001:db8:')
  );
}

export function isBlockedIp(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isBlockedIpv4(address);
  if (version === 6) return isBlockedIpv6(address);
  return true;
}

export async function resolveSafePublicUrl(
  value: string,
): Promise<ResolvedPublicUrl> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('INVALID_REFERENCE');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error('SSRF_BLOCKED');
  }
  const port = url.port
    ? Number(url.port)
    : url.protocol === 'https:'
      ? 443
      : 80;
  if (![80, 443].includes(port)) throw new Error('SSRF_BLOCKED');
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (hostname === 'localhost' || hostname.endsWith('.local'))
    throw new Error('SSRF_BLOCKED');

  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) throw new Error('SSRF_BLOCKED');
    return {
      url,
      addresses: [{ address: hostname, family: isIP(hostname) as 4 | 6 }],
    };
  }

  const [ipv4, ipv6] = await Promise.all([
    resolve4(hostname).catch(() => []),
    resolve6(hostname).catch(() => []),
  ]);
  const addresses = [...ipv4, ...ipv6];
  if (addresses.length === 0) throw new Error('SOURCE_UNAVAILABLE');
  if (addresses.some(isBlockedIp)) throw new Error('SSRF_BLOCKED');
  return {
    url,
    addresses: [
      ...ipv4.map((address) => ({ address, family: 4 as const })),
      ...ipv6.map((address) => ({ address, family: 6 as const })),
    ],
  };
}

export async function assertSafePublicUrl(value: string): Promise<URL> {
  return (await resolveSafePublicUrl(value)).url;
}
