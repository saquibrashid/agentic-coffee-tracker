import { describe, expect, it } from 'vitest';
import { assertSafeUrl, isBlockedAddress, UnsafeUrlError } from './safeFetch.js';

/**
 * These guards are what replaced the hostname allowlist, so they are the only
 * thing standing between a model-proposed URL and the function's own network.
 */
describe('isBlockedAddress', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['10.1.2.3', 'RFC 1918'],
    ['172.16.0.1', 'RFC 1918'],
    ['172.31.255.255', 'RFC 1918 upper bound'],
    ['192.168.1.1', 'RFC 1918'],
    ['169.254.169.254', 'Azure instance metadata'],
    ['100.64.0.1', 'CGNAT'],
    ['0.0.0.0', 'this network'],
    ['255.255.255.255', 'broadcast'],
  ])('blocks %s (%s)', (ip) => {
    expect(isBlockedAddress(ip, 4)).toBe(true);
  });

  it.each([['8.8.8.8'], ['1.1.1.1'], ['172.32.0.1'], ['99.99.99.99']])(
    'allows the public address %s',
    (ip) => {
      expect(isBlockedAddress(ip, 4)).toBe(false);
    },
  );

  it.each([
    ['::1', 'loopback'],
    ['fc00::1', 'unique-local'],
    ['fe80::1', 'link-local'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
    ['::ffff:169.254.169.254', 'IPv4-mapped metadata endpoint'],
  ])('blocks the IPv6 address %s (%s)', (ip) => {
    expect(isBlockedAddress(ip, 6)).toBe(true);
  });

  it('allows a public IPv6 address', () => {
    expect(isBlockedAddress('2606:4700:4700::1111', 6)).toBe(false);
  });
});

describe('assertSafeUrl', () => {
  it('rejects a non-http scheme', async () => {
    await expect(assertSafeUrl('file:///etc/passwd')).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('rejects a non-default port', async () => {
    await expect(assertSafeUrl('http://example.com:8080/')).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('rejects a literal loopback host', async () => {
    await expect(assertSafeUrl('http://127.0.0.1/admin')).rejects.toThrow(/private address/);
  });

  it('rejects the instance metadata endpoint', async () => {
    await expect(assertSafeUrl('http://169.254.169.254/metadata/identity')).rejects.toThrow(
      /private address/,
    );
  });

  it('rejects a host that cannot be resolved', async () => {
    // `.invalid` is reserved by RFC 2606 and is guaranteed never to resolve.
    await expect(assertSafeUrl('https://nothing.invalid/')).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('accepts a public https URL', async () => {
    const url = await assertSafeUrl('https://example.com/products/coffee');
    expect(url.hostname).toBe('example.com');
  });
});
