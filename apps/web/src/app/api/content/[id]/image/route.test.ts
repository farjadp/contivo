import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sessionMock, findFirstMock, uploadMock } = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  findFirstMock: vi.fn(),
  uploadMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ getSession: sessionMock }));
vi.mock('@/lib/db', () => ({ prisma: { contentImage: { findFirst: findFirstMock } } }));
vi.mock('@/lib/content-image-service', () => ({ uploadImageForItem: uploadMock }));

import { GET, POST } from './route';

const params = { params: Promise.resolve({ id: 'i1' }) };

beforeEach(() => {
  vi.clearAllMocks();
  sessionMock.mockResolvedValue({ userId: 'u1' });
});

describe('/api/content/[id]/image', () => {
  it('GET needs a session and scopes the picture to its owner', async () => {
    sessionMock.mockResolvedValue(null);
    expect((await GET(new Request('http://x/api/content/i1/image'), params)).status).toBe(401);

    sessionMock.mockResolvedValue({ userId: 'u1' });
    findFirstMock.mockResolvedValue(null);
    expect((await GET(new Request('http://x/api/content/i1/image'), params)).status).toBe(404);
    expect(findFirstMock.mock.calls[0][0].where).toEqual({ contentItemId: 'i1', contentItem: { workspace: { userId: 'u1' } } });
  });

  it('GET serves the bytes privately with their type', async () => {
    findFirstMock.mockResolvedValue({ data: Buffer.from([1, 2, 3]), mimeType: 'image/jpeg' });
    const res = await GET(new Request('http://x/api/content/i1/image'), params);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toContain('private');
  });

  it('POST refuses an oversized body before reading it', async () => {
    const req = new Request('http://x/api/content/i1/image?workspaceId=w1', {
      method: 'POST',
      headers: { 'content-length': String(20 * 1024 * 1024) },
      body: 'x',
    });
    const res = await POST(req, params);
    expect(res.status).toBe(413);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('POST hands the file to the service with the session user', async () => {
    uploadMock.mockResolvedValue({ ok: false, error: 'not_found' });
    const body = new FormData();
    body.append('file', new Blob([new Uint8Array([0x89, 0x50])], { type: 'image/png' }), 'a.png');
    const res = await POST(new Request('http://x/api/content/i1/image?workspaceId=w1', { method: 'POST', body }), params);
    expect(res.status).toBe(404);
    expect(uploadMock).toHaveBeenCalledWith({ userId: 'u1', workspaceId: 'w1' }, 'i1', expect.any(Uint8Array));
  });
});
