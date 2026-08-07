import { describe, expect, it } from 'vitest';

import { ALLOWED_IMAGE_TYPES, normalizeContentType, sniffImageType } from './imageType.js';

/** Builds a buffer of `size` bytes starting with `head`. */
function withHead(head: number[], size = 32): Buffer {
  const buf = Buffer.alloc(size);
  Buffer.from(head).copy(buf);
  return buf;
}

function riff(tag: string): Buffer {
  const buf = Buffer.alloc(32);
  buf.write('RIFF', 0, 'latin1');
  buf.writeUInt32LE(24, 4);
  buf.write(tag, 8, 'latin1');
  return buf;
}

function isoBmff(brand: string): Buffer {
  const buf = Buffer.alloc(32);
  buf.writeUInt32BE(24, 0);
  buf.write('ftyp', 4, 'latin1');
  buf.write(brand, 8, 'latin1');
  return buf;
}

describe('sniffImageType', () => {
  it('recognises the formats the app accepts', () => {
    expect(sniffImageType(withHead([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageType(withHead([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      'image/png',
    );
    expect(sniffImageType(Buffer.from('GIF89a'.padEnd(32, '\0'), 'latin1'))).toBe('image/gif');
    expect(sniffImageType(riff('WEBP'))).toBe('image/webp');
    expect(sniffImageType(isoBmff('avif'))).toBe('image/avif');
    expect(sniffImageType(isoBmff('avis'))).toBe('image/avif');
  });

  it('rejects SVG however it is dressed up', () => {
    // The whole point: SVG is script-capable and must never reach a data URL
    // the app renders, even when the server swears it is a PNG.
    expect(
      sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')),
    ).toBeUndefined();
    expect(sniffImageType(Buffer.from('<?xml version="1.0"?><svg></svg>'))).toBeUndefined();
    expect(ALLOWED_IMAGE_TYPES.has('image/svg+xml')).toBe(false);
  });

  it('rejects content that is not an image at all', () => {
    expect(sniffImageType(Buffer.from('<!DOCTYPE html><html></html>'))).toBeUndefined();
    expect(sniffImageType(Buffer.from('{"not":"an image at all really"}'))).toBeUndefined();
    expect(sniffImageType(Buffer.alloc(32))).toBeUndefined();
  });

  it('rejects a RIFF container that is not WebP', () => {
    // RIFF also carries WAV and AVI; only the WEBP tag counts.
    expect(sniffImageType(riff('WAVE'))).toBeUndefined();
    expect(sniffImageType(riff('AVI '))).toBeUndefined();
  });

  it('rejects an ISO-BMFF file that is not AVIF', () => {
    // MP4 shares the ftyp box; an mp4 brand must not pass as an image.
    expect(sniffImageType(isoBmff('mp42'))).toBeUndefined();
    expect(sniffImageType(isoBmff('heic'))).toBeUndefined();
  });

  it('refuses to guess from a truncated payload', () => {
    // A prefix can match by luck, so anything too short to be conclusive is
    // treated as unknown rather than trusted.
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff]))).toBeUndefined();
    expect(sniffImageType(Buffer.alloc(0))).toBeUndefined();
    expect(sniffImageType(Buffer.alloc(11))).toBeUndefined();
  });
});

describe('normalizeContentType', () => {
  it('strips parameters and normalises case', () => {
    expect(normalizeContentType('image/JPEG; charset=binary')).toBe('image/jpeg');
    expect(normalizeContentType('  image/png  ')).toBe('image/png');
    expect(normalizeContentType('')).toBe('');
  });
});
