import { getFormatter, getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { countUnseenReports } from '@/lib/bug-report/admin-queries';

/** Admin rail link to Reports, with the count of reports nobody has opened yet. */
export async function ReportsNavLink() {
  const t = await getTranslations('bugReport.admin');
  const format = await getFormatter();
  let unseen = 0;
  try {
    unseen = await countUnseenReports();
  } catch (error) {
    // A failed count must not take the whole admin rail down; the link still works.
    console.error('reports nav: unseen count failed', error instanceof Error ? error.message : 'unknown');
  }

  return (
    <Link
      href="/admin/reports"
      className="flex items-center justify-between gap-2 rounded-xl border border-transparent px-4 py-3 text-start text-sm font-semibold text-moss-muted transition hover:border-rule hover:bg-chalk hover:text-moss"
    >
      <span>{t('nav')}</span>
      {unseen > 0 ? (
        <span
          aria-label={t('newBadge', { count: unseen })}
          className="min-w-6 rounded-full bg-saffron px-2 text-center text-[11px] font-bold leading-6 tabular-nums text-moss"
        >
          {format.number(Math.min(unseen, 99))}{unseen > 99 ? '+' : ''}
        </span>
      ) : null}
    </Link>
  );
}
