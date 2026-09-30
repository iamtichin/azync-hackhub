export function trustProxyHops(value: string | undefined): number {
  if (value === undefined || value === '') return 0;
  if (!/^\d+$/.test(value)) throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 10');
  const hops = Number(value);
  if (!Number.isSafeInteger(hops) || hops < 0 || hops > 10) throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 10');
  return hops;
}
