import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, sessionMock, redirectMock, revalidateMock, logMock } = vi.hoisted(() => ({
  prismaMock: { bugReport: { findUnique: vi.fn(), updateMany: vi.fn() } },
  sessionMock: { getSession: vi.fn() },
  redirectMock: vi.fn(() => {
    throw new Error('REDIRECT');
  }),
  revalidateMock: vi.fn(),
  logMock: { writeActivityLog: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => sessionMock);
vi.mock('@/i18n/navigation', () => ({ redirect: redirectMock }));
vi.mock('next/cache', () => ({ revalidatePath: revalidateMock }));
vi.mock('next-intl/server', () => ({ getLocale: async () => 'en' }));
vi.mock('@/lib/activity-log', () => logMock);

import { setReportStatus } from './bug-reports-admin';

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  sessionMock.getSession.mockResolvedValue({ userId: 'admin1', role: 'ADMIN' });
  prismaMock.bugReport.findUnique.mockResolvedValue({ id: 'r1', fingerprint: 'fpA' });
  prismaMock.bugReport.updateMany.mockResolvedValue({ count: 1 });
});

describe('setReportStatus', () => {
  it('redirects non-admins and writes nothing', async () => {
    sessionMock.getSession.mockResolvedValue({ userId: 'u', role: 'USER' });
    await expect(setReportStatus(form({ referenceCode: 'CTV-7F3K', status: 'FIXED' }))).rejects.toThrow('REDIRECT');
    expect(prismaMock.bugReport.updateMany).not.toHaveBeenCalled();
  });

  it('FIXED sets resolvedAt, one report only, and revalidates', async () => {
    await setReportStatus(form({ referenceCode: 'CTV-7F3K', status: 'FIXED' }));
    const arg = prismaMock.bugReport.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'r1' });
    expect(arg.data.status).toBe('FIXED');
    expect(arg.data.resolvedAt).toBeInstanceOf(Date);
    expect(revalidateMock).toHaveBeenCalledWith('/admin/reports');
    expect(logMock.writeActivityLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'ADMIN_BUG_REPORT_STATUS' }));
  });

  it('SEEN clears resolvedAt', async () => {
    await setReportStatus(form({ referenceCode: 'CTV-7F3K', status: 'SEEN' }));
    expect(prismaMock.bugReport.updateMany.mock.calls[0][0].data).toEqual({ status: 'SEEN', resolvedAt: null });
  });

  it('applyToGroup updates every report with the same fingerprint', async () => {
    await setReportStatus(form({ referenceCode: 'CTV-7F3K', status: 'WONTFIX', applyToGroup: 'on' }));
    expect(prismaMock.bugReport.updateMany.mock.calls[0][0].where).toEqual({ fingerprint: 'fpA' });
  });

  it('rejects an invalid status or reference without writing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await setReportStatus(form({ referenceCode: 'CTV-7F3K', status: 'DONE' }));
    await setReportStatus(form({ referenceCode: 'bogus', status: 'FIXED' }));
    warn.mockRestore();
    expect(prismaMock.bugReport.updateMany).not.toHaveBeenCalled();
  });
});
