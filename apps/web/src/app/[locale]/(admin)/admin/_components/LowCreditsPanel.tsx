import { useFormatter, useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { AUTOPILOT_RUN_COST } from '@/lib/credit-costs';
import type { RankedLowCreditRow } from '@/lib/credit-requests';

import { Panel, createAdminFormat } from './AdminUi';

/**
 * Accounts that cannot pay for one Autopilot run, and anyone who pressed
 * "Request more credits". Pending requests come first. "Top up" opens the
 * credits section filtered to that user, with the adjustment form preselected.
 */
export function LowCreditsPanel({ rows }: { rows: RankedLowCreditRow[] }) {
  const t = useTranslations('admin');
  const fmt = createAdminFormat(useFormatter(), t);

  return (
    <Panel title={t('lowCredits.title')} subtitle={t('lowCredits.subtitle', { cost: AUTOPILOT_RUN_COST })}>
      {rows.length === 0 ? (
        <p className="text-sm text-moss-muted">{t('lowCredits.empty')}</p>
      ) : (
        <div className="max-h-[420px] overflow-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-rule text-xs uppercase tracking-wider text-moss-muted">
                <th className="px-3 py-3 text-start">{t('lowCredits.colUser')}</th>
                <th className="px-3 py-3 text-start">{t('lowCredits.colBalance')}</th>
                <th className="px-3 py-3 text-start">{t('lowCredits.colRequest')}</th>
                <th className="px-3 py-3 text-start">{t('lowCredits.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.userId} className={`border-b border-rule ${row.pending ? 'bg-amber-50' : ''}`}>
                  <td className="px-3 py-3">
                    <p className="font-medium text-moss"><bdi>{row.email}</bdi></p>
                    {row.name ? <p className="text-xs text-moss-muted"><bdi>{row.name}</bdi></p> : null}
                  </td>
                  <td className="px-3 py-3">
                    <p className={`font-bold ${row.balance <= 0 ? 'text-red-700' : 'text-amber-800'}`}>{fmt.number(row.balance)}</p>
                    {row.ledgerRows === 0 ? <p className="text-xs text-moss-muted">{t('lowCredits.noLedger')}</p> : null}
                  </td>
                  <td className="px-3 py-3 text-xs">
                    {row.pending && row.lastRequestAt ? (
                      <span className="font-semibold text-amber-900">
                        {t('lowCredits.pending', { when: fmt.dateTime(row.lastRequestAt) })}
                      </span>
                    ) : (
                      <span className="text-moss-muted">{t('lowCredits.noRequest')}</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-3 text-xs font-bold">
                      <Link
                        href={{ pathname: '/admin', query: { section: 'credits', userId: row.userId } }}
                        className="text-moss hover:underline"
                      >
                        {t('lowCredits.topUp')}
                      </Link>
                      <Link
                        href={{ pathname: '/admin/users/[userId]', params: { userId: row.userId } }}
                        className="text-moss-muted hover:underline"
                      >
                        {t('lowCredits.userPage')}
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/** One line on the overview so a request is seen without opening the credits section. */
export function PendingCreditRequestsNotice({ count }: { count: number }) {
  const t = useTranslations('admin');
  if (count === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm text-amber-900">
      <span className="font-semibold">{t('lowCredits.pendingCount', { count })}</span>
      <Link href={{ pathname: '/admin', query: { section: 'credits' } }} className="font-bold text-moss hover:underline">
        {t('lowCredits.review')}
      </Link>
    </div>
  );
}
