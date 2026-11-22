/**
 * LinkedInExpiryCard.tsx
 *
 * Admin overview: how many LinkedIn connections have run past their 60-day
 * sign-in, and how many will within a week. Self-contained server component.
 * A failed count is shown as unavailable, never as a reassuring zero.
 */

import { getTranslations } from 'next-intl/server';

import { getLinkedInExpiryCounts } from '@/lib/admin-console';
import { EXPIRY_WARNING_DAYS } from '@/lib/connection-health';

const LINKEDIN_SIGN_IN_DAYS = 60;

export async function LinkedInExpiryCard() {
  const t = await getTranslations('admin');
  let counts: Awaited<ReturnType<typeof getLinkedInExpiryCounts>> | null = null;
  try {
    counts = await getLinkedInExpiryCounts();
  } catch (err) {
    console.error('[admin] LinkedIn expiry counts failed', err);
  }

  const attention = counts == null || counts.expired > 0 || counts.expiringSoon > 0;
  return (
    <section
      aria-labelledby="linkedin-expiry-title"
      className={`mt-6 rounded-3xl border p-5 ${attention ? 'border-amber-300 bg-amber-50/60' : 'border-rule/60 bg-chalk-sunk/50'}`}
    >
      <h3 id="linkedin-expiry-title" className="text-sm font-bold text-moss">
        {t.rich('health.linkedinExpiryTitle', { bdi: (c) => <bdi>{c}</bdi> })}
      </h3>
      <p className="mt-2 text-xs font-medium leading-relaxed text-moss-muted">
        {counts
          ? t('health.linkedinExpiryDescription', {
              expired: counts.expired,
              soon: counts.expiringSoon,
              days: EXPIRY_WARNING_DAYS,
              period: LINKEDIN_SIGN_IN_DAYS,
            })
          : t('common.noData')}
      </p>
    </section>
  );
}
