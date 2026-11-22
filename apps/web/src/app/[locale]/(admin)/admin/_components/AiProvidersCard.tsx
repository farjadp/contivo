import { useFormatter, useTranslations } from 'next-intl';

import type { AdminAiProviderRow, AdminAiProviders } from '@/lib/admin-console';
import { EmptyState, Panel } from './AdminUi';

/*
  Provider ids, task ids and error classes are the values the AI layer writes
  to the database. They stay Latin in every locale, inside an LTR span, so an
  admin can grep the logs for exactly what they read here.
*/

type ProviderState = 'notConfigured' | 'coolingDown' | 'healthy' | 'unknown';

function providerState(row: AdminAiProviderRow, now: Date): ProviderState {
  if (!row.configured && row.healthy !== null) return 'notConfigured';
  if (row.healthy === null) return 'unknown';
  if (!row.healthy || (row.coolingDownUntil && row.coolingDownUntil > now)) return 'coolingDown';
  return 'healthy';
}

const STATE_TONE: Record<ProviderState, string> = {
  healthy: 'text-moss-700 bg-chalk-sunk border-rule',
  coolingDown: 'text-red-700 bg-red-50 border-red-200',
  notConfigured: 'text-amber-700 bg-amber-50 border-amber-200',
  unknown: 'text-moss bg-chalk border-rule',
};

function Code({ children }: { children: string }) {
  return (
    <span dir="ltr" className="font-plexmono text-xs text-moss">
      {children}
    </span>
  );
}

export function AiProvidersCard({ data, now = new Date() }: { data: AdminAiProviders; now?: Date }) {
  const t = useTranslations('admin.aiProviders');
  const format = useFormatter();
  const number = (value: number) => format.number(value);
  const when = (value: Date | null) =>
    value ? format.dateTime(new Date(value), { dateStyle: 'medium', timeStyle: 'short' }) : '-';
  const usd = (value: number) =>
    format.number(value, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 });

  return (
    <div className="space-y-4">
      <Panel title={t('title')} subtitle={t('subtitle')}>
        {!data.liveHealthAvailable ? <p className="mb-4 text-sm font-semibold text-amber-700">{t('liveHealthUnavailable')}</p> : null}
        <p className="mb-4 text-xs text-moss-muted">{t('liveHealthNote')}</p>
        <div className="grid gap-4 md:grid-cols-3">
          {data.providers.map((row) => {
            const state = providerState(row, now);
            return (
              <div key={row.provider} className="rounded-2xl border border-rule/60 bg-chalk p-4">
                <div className="flex items-center justify-between gap-3">
                  <Code>{row.provider}</Code>
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${STATE_TONE[state]}`}>
                    {t(`state.${state}`)}
                  </span>
                </div>
                <dl className="mt-4 space-y-2 text-sm">
                  {state === 'coolingDown' && row.coolingDownUntil ? (
                    <div className="flex justify-between gap-3">
                      <dt className="text-moss-muted">{t('coolingDownUntil')}</dt>
                      <dd className="text-moss">{when(row.coolingDownUntil)}</dd>
                    </div>
                  ) : null}
                  {row.reason ? (
                    <div className="flex justify-between gap-3">
                      <dt className="text-moss-muted">{t('reason')}</dt>
                      <dd><Code>{row.reason}</Code></dd>
                    </div>
                  ) : null}
                  <div className="flex justify-between gap-3">
                    <dt className="text-moss-muted">{t('lastError')}</dt>
                    <dd className="text-end">
                      {row.lastErrorClass ? (
                        <>
                          <Code>{row.lastErrorClass}</Code>
                          <span className="block text-xs text-moss-muted">{when(row.lastErrorAt)}</span>
                        </>
                      ) : (
                        <span className="text-moss-muted">{t('none')}</span>
                      )}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-moss-muted">{t('failedAttempts')}</dt>
                    <dd className="font-semibold text-moss">{number(row.failedAttempts)}</dd>
                  </div>
                </dl>
              </div>
            );
          })}
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t('failoversTitle')} subtitle={t('failoversSubtitle')}>
          {!data.eventsAvailable ? (
            <EmptyState text={t('eventsUnavailable')} />
          ) : data.failoversByTask.length === 0 ? (
            <EmptyState text={t('noFailovers')} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-rule text-moss-muted">
                    <th className="px-3 py-3 text-start text-xs font-bold">{t('colTask')}</th>
                    <th className="px-3 py-3 text-start text-xs font-bold">{t('colFailovers')}</th>
                    <th className="px-3 py-3 text-start text-xs font-bold">{t('colUnrecovered')}</th>
                    <th className="px-3 py-3 text-start text-xs font-bold">{t('colAllUnavailable')}</th>
                    <th className="px-3 py-3 text-start text-xs font-bold">{t('colLast')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule/80">
                  {data.failoversByTask.map((row) => (
                    <tr key={row.task}>
                      <td className="px-3 py-3 align-top">
                        <Code>{row.task}</Code>
                        {row.routes.length > 0 ? (
                          <ul className="mt-1 space-y-0.5">
                            {row.routes.map((route) => (
                              <li key={`${route.from}-${route.to}`} className="text-xs text-moss-muted">
                                <span dir="ltr" className="font-plexmono">{`${route.from} → ${route.to}`}</span>{' '}
                                {t('routeCount', { count: route.count })}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 align-top text-moss">{number(row.failovers)}</td>
                      <td className="px-3 py-3 align-top text-moss">{number(row.unrecovered)}</td>
                      <td className={`px-3 py-3 align-top ${row.allUnavailable > 0 ? 'font-bold text-red-700' : 'text-moss'}`}>
                        {number(row.allUnavailable)}
                      </td>
                      <td className="px-3 py-3 align-top text-xs text-moss-muted">{when(row.lastAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.eventsTruncated ? <p className="mt-3 text-xs text-amber-700">{t('eventsTruncated')}</p> : null}
            </div>
          )}
        </Panel>

        <Panel title={t('answeredTitle')} subtitle={t('answeredSubtitle')}>
          {!data.usageAvailable ? (
            <EmptyState text={t('usageUnavailable')} />
          ) : data.answeredBy.length === 0 ? (
            <EmptyState text={t('noUsage')} />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-rule text-moss-muted">
                  <th className="px-3 py-3 text-start text-xs font-bold">{t('colProvider')}</th>
                  <th className="px-3 py-3 text-start text-xs font-bold">{t('colRequests')}</th>
                  <th className="px-3 py-3 text-start text-xs font-bold">{t('colCost')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule/80">
                {data.answeredBy.map((row) => (
                  <tr key={row.provider ?? 'unrecorded'}>
                    <td className="px-3 py-3">
                      {row.provider ? <Code>{row.provider}</Code> : <span className="text-moss-muted">{t('providerUnrecorded')}</span>}
                    </td>
                    <td className="px-3 py-3 text-moss">{number(row.requests)}</td>
                    <td className="px-3 py-3 text-moss">{usd(row.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>

      {data.eventsAvailable && data.recentEvents.length > 0 ? (
        <Panel title={t('recentTitle')} subtitle={t('recentSubtitle')}>
          <ul className="divide-y divide-rule/80">
            {data.recentEvents.map((event, index) => (
              <li key={`${event.createdAt.toString()}-${index}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm">
                <span className="text-xs text-moss-muted">{when(event.createdAt)}</span>
                <Code>{event.eventType}</Code>
                <Code>{`${event.provider} / ${event.task}`}</Code>
                <Code>{event.status ? `${event.errorClass} ${event.status}` : event.errorClass}</Code>
                {event.failedOverTo ? <Code>{`→ ${event.failedOverTo}`}</Code> : null}
                {event.message ? (
                  <span dir="ltr" className="basis-full truncate text-xs text-moss-muted">
                    {event.message}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}
