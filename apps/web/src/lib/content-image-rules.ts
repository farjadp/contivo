/**
 * content-image-rules.ts
 *
 * Pure and client-safe: which channels carry a picture, what an upload may
 * be, and when an item's picture can still change. Shared by the Ideation
 * tab, Write a post, the pipeline card, the upload route and the actions so
 * the browser and the server refuse the same things.
 */

/**
 * Channels whose publisher sends the item's image. LinkedIn uploads it through
 * registerUpload; Telegram sends it as a photo. Other channels publish text only.
 */
export const IMAGE_CHANNELS: ReadonlySet<string> = new Set(['linkedin', 'telegram']);

export function channelCarriesImage(channel: unknown): boolean {
  return IMAGE_CHANNELS.has(String(channel ?? '').trim().toLowerCase());
}

/** 5 MB: well under LinkedIn's and Telegram's photo limits, and a sane row size. */
export const IMAGE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

export const IMAGE_UPLOAD_TYPES = ['image/png', 'image/jpeg'] as const;
export type ImageUploadType = (typeof IMAGE_UPLOAD_TYPES)[number];

/** What the file picker offers. The server still checks the bytes. */
export const IMAGE_UPLOAD_ACCEPT = 'image/png,image/jpeg';

export type ImageUploadError = 'empty' | 'too_large' | 'wrong_type';

/**
 * The type the bytes really are, from their signature. The browser's declared
 * type and the file name are not trusted: a renamed file is still refused.
 */
export function sniffImageType(head: Uint8Array): ImageUploadType | null {
  if (
    head.length >= 8 &&
    head[0] === 0x89 &&
    head[1] === 0x50 &&
    head[2] === 0x4e &&
    head[3] === 0x47 &&
    head[4] === 0x0d &&
    head[5] === 0x0a &&
    head[6] === 0x1a &&
    head[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  return null;
}

/** Size and declared type, before any bytes are read (the browser's first check). */
export function precheckImageUpload(file: { size: number; type: string }): ImageUploadError | null {
  if (!file.size) return 'empty';
  if (file.size > IMAGE_UPLOAD_MAX_BYTES) return 'too_large';
  if (!(IMAGE_UPLOAD_TYPES as readonly string[]).includes(String(file.type).toLowerCase())) return 'wrong_type';
  return null;
}

/** The server's check: size plus the real signature. */
export function validateImageBytes(
  bytes: Uint8Array,
): { ok: true; mimeType: ImageUploadType } | { ok: false; error: ImageUploadError } {
  if (bytes.byteLength === 0) return { ok: false, error: 'empty' };
  if (bytes.byteLength > IMAGE_UPLOAD_MAX_BYTES) return { ok: false, error: 'too_large' };
  const mimeType = sniffImageType(bytes.subarray(0, 8));
  if (!mimeType) return { ok: false, error: 'wrong_type' };
  return { ok: true, mimeType };
}

/** Width and height from a PNG's IHDR or a JPEG's first SOF marker; null when not found. */
export function readImageSize(bytes: Uint8Array, mimeType: ImageUploadType): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mimeType === 'image/png') {
    if (bytes.byteLength < 24) return null;
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  let offset = 2;
  while (offset + 9 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    // SOF0..SOF15, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = view.getUint16(offset + 5);
      const width = view.getUint16(offset + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    const length = view.getUint16(offset + 2);
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

/** A published or publishing item keeps the picture it went out with. */
export function imageEditableForStatus(status: unknown): boolean {
  return status !== 'PUBLISHED' && status !== 'PUBLISHING';
}

/**
 * Alt text for a user-supplied picture: the post's own title, in the post's
 * own language (an English template would put English into a Persian post).
 */
export function uploadAltText(topic: string): string | null {
  const clean = String(topic ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return clean || null;
}
