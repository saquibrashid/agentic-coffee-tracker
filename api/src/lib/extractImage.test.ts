import { describe, expect, it } from 'vitest';
import { extractImageUrl } from './extractImage.js';

const BASE = 'https://roaster.example.com/products/yirgacheffe';

describe('extractImageUrl', () => {
  it('prefers og:image', () => {
    const html = `
      <meta property="og:image" content="https://cdn.test/bag.jpg">
      <img src="https://cdn.test/other.jpg">
    `;
    expect(extractImageUrl(html, BASE)).toBe('https://cdn.test/bag.jpg');
  });

  it('reads og:image when content comes before property', () => {
    const html = `<meta content="https://cdn.test/bag.jpg" property="og:image">`;
    expect(extractImageUrl(html, BASE)).toBe('https://cdn.test/bag.jpg');
  });

  it('accepts og:image:secure_url', () => {
    const html = `<meta property="og:image:secure_url" content="https://cdn.test/secure.jpg">`;
    expect(extractImageUrl(html, BASE)).toBe('https://cdn.test/secure.jpg');
  });

  it('falls back to twitter:image', () => {
    const html = `<meta name="twitter:image" content="https://cdn.test/tw.jpg">`;
    expect(extractImageUrl(html, BASE)).toBe('https://cdn.test/tw.jpg');
  });

  it('falls back to link rel=image_src', () => {
    const html = `<link rel="image_src" href="https://cdn.test/legacy.jpg">`;
    expect(extractImageUrl(html, BASE)).toBe('https://cdn.test/legacy.jpg');
  });

  it('resolves a root-relative source against the page URL', () => {
    const html = `<meta property="og:image" content="/media/bag.jpg">`;
    expect(extractImageUrl(html, BASE)).toBe('https://roaster.example.com/media/bag.jpg');
  });

  it('resolves a protocol-relative source', () => {
    const html = `<meta property="og:image" content="//cdn.test/bag.jpg">`;
    expect(extractImageUrl(html, BASE)).toBe('https://cdn.test/bag.jpg');
  });

  it('resolves a path-relative source against the page URL', () => {
    const html = `<meta property="og:image" content="bag.jpg">`;
    expect(extractImageUrl(html, BASE)).toBe('https://roaster.example.com/products/bag.jpg');
  });

  describe('body fallback', () => {
    it('uses the first content image when there is no metadata', () => {
      const html = `<img src="https://cdn.test/product.jpg">`;
      expect(extractImageUrl(html, BASE)).toBe('https://cdn.test/product.jpg');
    });

    it('skips site furniture that appears before the product shot', () => {
      const html = `
        <img src="https://cdn.test/logo.png">
        <img src="https://cdn.test/cart-icon.svg">
        <img src="https://cdn.test/visa-badge.png">
        <img src="https://cdn.test/product.jpg">
      `;
      expect(extractImageUrl(html, BASE)).toBe('https://cdn.test/product.jpg');
    });

    it('prefers data-src over a lazy-loading placeholder in src', () => {
      const html = `<img src="https://cdn.test/placeholder.gif" data-src="https://cdn.test/real.jpg">`;
      expect(extractImageUrl(html, BASE)).toBe('https://cdn.test/real.jpg');
    });

    it('ignores inline data URIs', () => {
      const html = `
        <img src="data:image/gif;base64,R0lGOD">
        <img src="https://cdn.test/product.jpg">
      `;
      expect(extractImageUrl(html, BASE)).toBe('https://cdn.test/product.jpg');
    });
  });

  it('rejects an SVG, which is a logo far more often than a bag', () => {
    const html = `<meta property="og:image" content="https://cdn.test/brand.svg">`;
    expect(extractImageUrl(html, BASE)).toBeUndefined();
  });

  it('rejects a javascript: source', () => {
    const html = `<img src="javascript:alert(1)">`;
    expect(extractImageUrl(html, BASE)).toBeUndefined();
  });

  it('returns undefined when the page has no images', () => {
    expect(extractImageUrl('<p>no pictures here</p>', BASE)).toBeUndefined();
  });
});
