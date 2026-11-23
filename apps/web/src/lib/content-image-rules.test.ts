import { describe, expect, it } from 'vitest';

import {
  channelCarriesImage,
  imageEditableForStatus,
  IMAGE_UPLOAD_MAX_BYTES,
  precheckImageUpload,
  readImageSize,
  sniffImageType,
  uploadAltText,
  validateImageBytes,
} from './content-image-rules';

/** A real 1x1 PNG header (signature + IHDR) with width 640, height 480. */
function pngBytes(width = 640, height = 480): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

/** SOI, an APP0 segment, then SOF0 with 1200x627. */
function jpegBytes(): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0)];
  const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x73, 0x04, 0xb0, 0x03, ...new Array(10).fill(0)];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof0]);
}

describe('content-image-rules', () => {
  it('only LinkedIn and Telegram carry a picture', () => {
    expect(channelCarriesImage('linkedin')).toBe(true);
    expect(channelCarriesImage('TELEGRAM')).toBe(true);
    for (const c of ['blog', 'twitter', 'email', 'threads', '', null]) expect(channelCarriesImage(c)).toBe(false);
  });

  it('reads the type from the bytes, not the name', () => {
    expect(sniffImageType(pngBytes())).toBe('image/png');
    expect(sniffImageType(jpegBytes())).toBe('image/jpeg');
    expect(sniffImageType(new TextEncoder().encode('GIF89a......'))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode('<svg xmlns='))).toBeNull();
  });

  it('refuses empty, oversized and non-PNG/JPG uploads', () => {
    expect(validateImageBytes(new Uint8Array())).toEqual({ ok: false, error: 'empty' });
    const big = new Uint8Array(IMAGE_UPLOAD_MAX_BYTES + 1);
    big.set(pngBytes());
    expect(validateImageBytes(big)).toEqual({ ok: false, error: 'too_large' });
    expect(validateImageBytes(new TextEncoder().encode('%PDF-1.7 renamed.png'))).toEqual({ ok: false, error: 'wrong_type' });
    expect(validateImageBytes(pngBytes())).toEqual({ ok: true, mimeType: 'image/png' });
  });

  it('prechecks in the browser by size and declared type', () => {
    expect(precheckImageUpload({ size: 0, type: 'image/png' })).toBe('empty');
    expect(precheckImageUpload({ size: IMAGE_UPLOAD_MAX_BYTES + 1, type: 'image/png' })).toBe('too_large');
    expect(precheckImageUpload({ size: 10, type: 'image/webp' })).toBe('wrong_type');
    expect(precheckImageUpload({ size: 10, type: 'image/jpeg' })).toBeNull();
  });

  it('reads PNG and JPEG dimensions', () => {
    expect(readImageSize(pngBytes(640, 480), 'image/png')).toEqual({ width: 640, height: 480 });
    expect(readImageSize(jpegBytes(), 'image/jpeg')).toEqual({ width: 1200, height: 627 });
    expect(readImageSize(new Uint8Array([0xff, 0xd8, 0x00]), 'image/jpeg')).toBeNull();
  });

  it('locks the picture once publishing starts', () => {
    expect(imageEditableForStatus('PUBLISHED')).toBe(false);
    expect(imageEditableForStatus('PUBLISHING')).toBe(false);
    for (const s of ['DRAFT', 'GENERATED', 'READY', 'SCHEDULED', 'FAILED']) expect(imageEditableForStatus(s)).toBe(true);
  });

  it('uses the post title as alt text, in its own language', () => {
    expect(uploadAltText('  پنج اشتباه رایج‌ در   قیمت‌گذاری ')).toBe('پنج اشتباه رایج‌ در قیمت‌گذاری');
    expect(uploadAltText('')).toBeNull();
  });
});
