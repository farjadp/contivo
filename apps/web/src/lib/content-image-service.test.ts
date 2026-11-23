import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, txMock, generateMock, recordFailureMock, balanceMock, deductMock, logMock } = vi.hoisted(() => {
  const txMock = {
    contentImage: { deleteMany: vi.fn(), create: vi.fn() },
  };
  return {
    txMock,
    prismaMock: {
      contentItem: { findFirst: vi.fn() },
      contentImage: { deleteMany: vi.fn() },
      $transaction: vi.fn(async (fn: (tx: typeof txMock) => unknown) => fn(txMock)),
    },
    generateMock: vi.fn(),
    recordFailureMock: vi.fn(),
    balanceMock: vi.fn(),
    deductMock: vi.fn(),
    logMock: vi.fn(),
  };
});

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/content-image', () => ({ generateImageForContentItem: generateMock }));
vi.mock('@/lib/bug-report/action-failure', () => ({ recordActionFailure: recordFailureMock }));
vi.mock('@/lib/credits', () => ({ getCreditBalance: balanceMock, deductCredits: deductMock }));
vi.mock('@/lib/activity-log', () => ({ writeActivityLog: logMock }));

import { IMAGE_GENERATION_COST } from '@/lib/credit-costs';

import { generateImageForItem, readGeneratorResult, removeImageForItem, uploadImageForItem } from './content-image-service';

const actor = { userId: 'u1', workspaceId: 'w1' };
const item = { id: 'i1', topic: 'Five pricing mistakes', content: 'Body', status: 'READY', channel: 'linkedin', workspace: { brandSummary: {} } };
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 2, 0x80, 0, 0, 1, 0xe0]);

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.contentItem.findFirst.mockResolvedValue(item);
  balanceMock.mockResolvedValue(50);
});

describe('generateImageForItem', () => {
  it('looks the item up by workspace AND owner', async () => {
    prismaMock.contentItem.findFirst.mockResolvedValue(null);
    expect(await generateImageForItem(actor, 'someone-elses')).toEqual({ ok: false, error: 'not_found' });
    expect(prismaMock.contentItem.findFirst.mock.calls[0][0].where).toEqual({
      id: 'someone-elses',
      workspaceId: 'w1',
      workspace: { userId: 'u1' },
    });
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('charges only after the picture is stored', async () => {
    generateMock.mockResolvedValue({ id: 'img1', prompt: 'p', altText: 'alt', bytes: 100 });
    const result = await generateImageForItem(actor, 'i1');
    expect(result).toEqual({ ok: true, image: { id: 'img1', altText: 'alt', mimeType: 'image/png', source: 'generated' } });
    expect(deductMock).toHaveBeenCalledWith('u1', IMAGE_GENERATION_COST, 'IMAGE_GENERATION', 'i1');
  });

  it('a failed generation is visible: reference, text only, nothing charged', async () => {
    generateMock.mockResolvedValue(null);
    recordFailureMock.mockResolvedValue({ ref: 'CTV-7F3K', code: 'PROVIDER_UNAVAILABLE' });
    const result = await generateImageForItem(actor, 'i1');
    expect(result).toEqual({ ok: false, error: 'generation_failed', ref: 'CTV-7F3K' });
    expect(deductMock).not.toHaveBeenCalled();
    expect(recordFailureMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'generateContentImage', workspaceId: 'w1', userId: 'u1' }));
    expect(logMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'CONTENT_IMAGE_FAILED', detail: expect.objectContaining({ ref: 'CTV-7F3K', textOnly: true }) }));
  });

  it('refuses before calling the model when credits are short', async () => {
    balanceMock.mockResolvedValue(IMAGE_GENERATION_COST - 1);
    expect(await generateImageForItem(actor, 'i1')).toEqual({
      ok: false,
      error: 'insufficient_credits',
      balance: IMAGE_GENERATION_COST - 1,
      required: IMAGE_GENERATION_COST,
    });
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('leaves a published post alone', async () => {
    prismaMock.contentItem.findFirst.mockResolvedValue({ ...item, status: 'PUBLISHED' });
    expect(await generateImageForItem(actor, 'i1')).toEqual({ ok: false, error: 'locked' });
    expect(await removeImageForItem(actor, 'i1')).toEqual({ ok: false, error: 'locked' });
    expect(await uploadImageForItem(actor, 'i1', png)).toEqual({ ok: false, error: 'locked' });
    expect(generateMock).not.toHaveBeenCalled();
    expect(prismaMock.contentImage.deleteMany).not.toHaveBeenCalled();
  });
});

describe('stubbed generator (B19: the real model is down until the registry fix ships)', () => {
  it('a coded failure object is a failure, never a picture, and keeps its code', async () => {
    generateMock.mockResolvedValue({ ok: false, code: 'MODEL_UNAVAILABLE', message: 'model does not exist' });
    recordFailureMock.mockResolvedValue({ ref: 'CTV-B19X', code: 'PROVIDER_UNAVAILABLE' });
    expect(await generateImageForItem(actor, 'i1')).toEqual({ ok: false, error: 'generation_failed', ref: 'CTV-B19X' });
    expect(deductMock).not.toHaveBeenCalled();
    expect(recordFailureMock).toHaveBeenCalledWith(expect.objectContaining({ code: 'PROVIDER_UNAVAILABLE' }));
    expect(logMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CONTENT_IMAGE_FAILED', detail: expect.objectContaining({ failureCode: 'MODEL_UNAVAILABLE', textOnly: true }) }),
    );
  });

  it('a known cause code passes through to the reference record', async () => {
    generateMock.mockResolvedValue({ ok: false, cause: 'PROVIDER_RATE_LIMITED' });
    recordFailureMock.mockResolvedValue({ ref: 'CTV-RATE', code: 'PROVIDER_RATE_LIMITED' });
    await generateImageForItem(actor, 'i1');
    expect(recordFailureMock).toHaveBeenCalledWith(expect.objectContaining({ code: 'PROVIDER_RATE_LIMITED' }));
  });

  it('B19 shape: the shared cause is recorded, the specific IMAGE_* code is logged', () => {
    expect(readGeneratorResult({ ok: false, code: 'IMAGE_MODEL_UNAVAILABLE', cause: 'PROVIDER_AUTH', model: 'gpt-image-2.5-flare' })).toEqual({
      ok: false,
      cause: 'PROVIDER_AUTH',
      failureCode: 'IMAGE_MODEL_UNAVAILABLE',
    });
    expect(readGeneratorResult({ ok: false, cause: 'PROVIDER_TIMEOUT' })).toEqual({ ok: false, cause: 'PROVIDER_TIMEOUT', failureCode: 'PROVIDER_TIMEOUT' });
  });

  it('reads both generator shapes', () => {
    expect(readGeneratorResult(null)).toEqual({ ok: false, cause: 'PROVIDER_UNAVAILABLE', failureCode: null });
    expect(readGeneratorResult({ ok: true, id: 'img', altText: 'a', bytes: 9 })).toEqual({ ok: true, id: 'img', altText: 'a', bytes: 9 });
    expect(readGeneratorResult({ id: 'img', altText: 'a', bytes: 9 }).ok).toBe(true);
    expect(readGeneratorResult({ ok: false, id: 'img' }).ok).toBe(false);
  });
});

describe('uploadImageForItem', () => {
  it('replaces the picture with the checked bytes, stored like a generated one', async () => {
    txMock.contentImage.create.mockResolvedValue({ id: 'up1', altText: item.topic, mimeType: 'image/png', provider: 'upload' });
    const result = await uploadImageForItem(actor, 'i1', png);
    expect(result).toEqual({ ok: true, image: { id: 'up1', altText: item.topic, mimeType: 'image/png', source: 'upload' } });
    expect(txMock.contentImage.deleteMany).toHaveBeenCalledWith({ where: { contentItemId: 'i1' } });
    const data = txMock.contentImage.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ contentItemId: 'i1', workspaceId: 'w1', mimeType: 'image/png', width: 640, height: 480, provider: 'upload' });
    expect(deductMock).not.toHaveBeenCalled();
  });

  it('refuses a file that is not really a PNG or JPG', async () => {
    expect(await uploadImageForItem(actor, 'i1', new TextEncoder().encode('<svg onload=alert(1)>'))).toEqual({ ok: false, error: 'wrong_type' });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

describe('removeImageForItem', () => {
  it('removes every picture of the item', async () => {
    prismaMock.contentImage.deleteMany.mockResolvedValue({ count: 1 });
    expect(await removeImageForItem(actor, 'i1')).toEqual({ ok: true, image: null });
    expect(prismaMock.contentImage.deleteMany).toHaveBeenCalledWith({ where: { contentItemId: 'i1' } });
  });
});
