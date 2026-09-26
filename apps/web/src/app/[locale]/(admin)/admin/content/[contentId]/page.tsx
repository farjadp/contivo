import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { Link, getPathname } from '@/i18n/navigation';
import { listContentActivityLogs } from '@/lib/activity-log';
import { prisma } from '@/lib/db';
import {
  getLatestFrameworkMetadataForContentItem,
  listFrameworkMetadataForContentItem,
} from '@/lib/framework-metadata-log';
import {
  EmptyState,
  KeyValueGrid,
  LogList,
  MetricCard,
  PageHeader,
  Panel,
  StatusBadge,
  createAdminFormat,
} from '../../_components/AdminUi';

type Props = {
  params: Promise<{ contentId: string }>;
};

function countWords(value: string | null | undefined): number {
  return String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export default async function AdminContentDetailPage({ params }: Props) {
  const { contentId } = await params;
  const t = await getTranslations('admin');
  const locale = await getLocale();
  const fmt = createAdminFormat(await getFormatter(), t);

  const contentItem = await prisma.contentItem.findUnique({
    where: { id: contentId },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
      workspace: {
        select: {
          id: true,
          name: true,
          websiteUrl: true,
        },
      },
    },
  });

  if (!contentItem) notFound();

  const [frameworkMeta, frameworkHistory, contentLogs, relatedJob, aiUsage] = await Promise.all([
    getLatestFrameworkMetadataForContentItem(contentItem.userId, contentId),
    listFrameworkMetadataForContentItem(contentId, 20),
    listContentActivityLogs(contentId, 40),
    contentItem.jobId
      ? prisma.contentJob.findUnique({
          where: { id: contentItem.jobId },
        })
      : null,
    contentItem.jobId
      ? prisma.aiUsageLog.findFirst({
          where: { jobId: contentItem.jobId },
          orderBy: { createdAt: 'desc' },
        })
      : null,
  ]);

  const scheduledSummary = contentItem.scheduledAtUtc
    ? t('contentDetail.scheduledWithZone', {
        date: fmt.dateTime(contentItem.scheduledAtUtc),
        timezone: contentItem.scheduledTimezone || 'UTC',
      })
    : t('contentDetail.notScheduled');

  return (
    <div className="space-y-6">
      <PageHeader
        backHref={`${getPathname({ href: '/admin', locale })}?section=content`}
        backLabel={t('contentDetail.back')}
        title={contentItem.topic}
        subtitle={t('contentDetail.subtitle')}
        actions={
          <>
            {contentItem.workspace ? (
              <Link
                href={{ pathname: '/admin/workspaces/[workspaceId]', params: { workspaceId: contentItem.workspace.id } }}
                className="rounded-xl border border-rule bg-chalk-raised px-4 py-2 text-sm font-semibold text-moss transition hover:border-rule-strong hover:bg-chalk"
              >
                {t('contentDetail.openWorkspace')}
              </Link>
            ) : null}
            <Link
              href={{ pathname: '/admin/users/[userId]', params: { userId: contentItem.user.id } }}
              className="rounded-xl bg-moss px-4 py-2 text-sm font-semibold text-chalk"
            >
              {t('contentDetail.openUser')}
            </Link>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label={t('contentDetail.status')} value={contentItem.status} />
        <MetricCard label={t('contentDetail.wordCount')} value={fmt.number(countWords(contentItem.content))} />
        <MetricCard label={t('contentDetail.creditsCost')} value={fmt.number(contentItem.creditsCost)} />
        <MetricCard
          label={t('contentDetail.aiCost')}
          value={fmt.usd(Number(aiUsage?.estimatedCostUsd ?? 0))}
          helper={aiUsage ? t('units.tokens', { value: fmt.number(aiUsage.totalTokens) }) : t('contentDetail.noAiUsageLog')}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <Panel title={t('contentDetail.metadataTitle')} subtitle={t('contentDetail.metadataSubtitle')}>
          <KeyValueGrid
            items={[
              { label: t('contentDetail.contentId'), value: <span dir="ltr">{contentItem.id}</span> },
              { label: t('contentDetail.workspace'), value: contentItem.workspace ? <Link href={{ pathname: '/admin/workspaces/[workspaceId]', params: { workspaceId: contentItem.workspace.id } }} className="font-semibold text-moss hover:underline">{contentItem.workspace.name}</Link> : t('common.noWorkspace') },
              { label: t('contentDetail.user'), value: <Link href={{ pathname: '/admin/users/[userId]', params: { userId: contentItem.user.id } }} className="font-semibold text-moss hover:underline"><bdi>{contentItem.user.email}</bdi></Link> },
              { label: t('contentDetail.platform'), value: contentItem.channel },
              { label: t('contentDetail.type'), value: contentItem.type },
              { label: t('contentDetail.status'), value: <StatusBadge status={contentItem.status} /> },
              { label: t('contentDetail.createdAt'), value: fmt.dateTime(contentItem.createdAt) },
              { label: t('contentDetail.updatedAt'), value: fmt.dateTime(contentItem.updatedAt) },
            ]}
            columns={2}
          />
        </Panel>

        <Panel title={t('contentDetail.scheduleTitle')} subtitle={t('contentDetail.scheduleSubtitle')}>
          <KeyValueGrid
            items={[
              { label: t('contentDetail.scheduled'), value: scheduledSummary },
              { label: t('contentDetail.publishedAt'), value: fmt.dateTime(contentItem.publishedAtUtc) },
              { label: t('contentDetail.jobId'), value: <span dir="ltr">{contentItem.jobId || '-'}</span> },
              { label: t('contentDetail.failureReason'), value: contentItem.failedReason || '-' },
              { label: t('contentDetail.campaign'), value: contentItem.campaign || '-' },
              { label: t('contentDetail.notes'), value: contentItem.notes || '-' },
            ]}
            columns={2}
          />
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Panel title={t('contentDetail.outputTitle')} subtitle={t('contentDetail.outputSubtitle')}>
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl border border-rule bg-chalk p-4 text-start text-[12px] leading-6 text-moss">
            {contentItem.content}
          </pre>
        </Panel>

        <Panel title={t('contentDetail.frameworkTitle')} subtitle={t('contentDetail.frameworkSubtitle')}>
          {frameworkMeta ? (
            <div className="space-y-4">
              <KeyValueGrid
                items={[
                  { label: t('contentDetail.framework'), value: frameworkMeta.frameworkName },
                  { label: t('contentDetail.frameworkId'), value: <span dir="ltr">{frameworkMeta.frameworkId}</span> },
                  { label: t('contentDetail.category'), value: frameworkMeta.frameworkCategory },
                  { label: t('contentDetail.selectionMode'), value: frameworkMeta.selectionMode },
                  { label: t('contentDetail.goal'), value: frameworkMeta.goal || '-' },
                  { label: t('contentDetail.platform'), value: frameworkMeta.platform || '-' },
                  { label: t('contentDetail.funnelStage'), value: frameworkMeta.funnelStage || '-' },
                  { label: t('contentDetail.fallback'), value: frameworkMeta.fallbackUsed ? t('common.yes') : t('common.no') },
                ]}
                columns={2}
              />
              <pre dir="ltr" className="overflow-x-auto whitespace-pre-wrap rounded-xl border border-rule bg-chalk p-3 text-start text-[11px] text-moss-muted">
                {JSON.stringify(frameworkMeta.qualityScores, null, 2)}
              </pre>
            </div>
          ) : (
            <EmptyState text={t('contentDetail.noFrameworkMetadata')} />
          )}
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Panel title={t('contentDetail.relatedJobTitle')} subtitle={t('contentDetail.relatedJobSubtitle')}>
          {relatedJob ? (
            <KeyValueGrid
              items={[
                { label: t('contentDetail.jobType'), value: relatedJob.type },
                { label: t('contentDetail.status'), value: <StatusBadge status={relatedJob.status} /> },
                { label: t('contentDetail.createdAt'), value: fmt.dateTime(relatedJob.createdAt) },
                { label: t('contentDetail.completedAt'), value: fmt.dateTime(relatedJob.completedAt) },
                { label: t('contentDetail.duration'), value: fmt.duration(relatedJob.completedAt ? new Date(relatedJob.completedAt).getTime() - new Date(relatedJob.createdAt).getTime() : null) },
                { label: t('contentDetail.creditsCost'), value: fmt.number(relatedJob.creditsCost) },
              ]}
              columns={2}
            />
          ) : (
            <EmptyState text={t('contentDetail.noRelatedJob')} />
          )}
        </Panel>

        <Panel title={t('contentDetail.historyTitle')} subtitle={t('contentDetail.historySubtitle')}>
          {frameworkHistory.length === 0 ? (
            <EmptyState text={t('contentDetail.noHistory')} />
          ) : (
            <div className="space-y-3">
              {frameworkHistory.map((entry: any) => (
                <div key={entry.id} className="rounded-xl border border-rule bg-chalk p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-bold text-moss">{entry.frameworkName}</p>
                    <p className="text-[11px] text-moss-muted">{fmt.dateTime(entry.createdAt)}</p>
                  </div>
                  <p className="mt-1 text-xs text-moss-muted">
                    {t('contentDetail.historyLine', {
                      event: entry.eventName,
                      mode: entry.selectionMode,
                      platform: entry.platform || '-',
                    })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel title={t('contentDetail.activityTitle')} subtitle={t('contentDetail.activitySubtitle')}>
        <LogList rows={contentLogs} />
      </Panel>
    </div>
  );
}
