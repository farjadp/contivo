/**
 * Contact.
 *
 * There is no form, on purpose: nothing behind this site sends mail, and a
 * form that posts into nowhere is worse than an address. So the page is the
 * address, made easy to use, plus one card per common reason for writing.
 * Each card opens a draft with the subject filled in and the body asking for
 * exactly what that kind of message needs, which saves a round of replies.
 */

import type { Metadata } from 'next';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { CopyAddress } from '@/components/marketing/contact-card';
import { Reveal } from '@/components/marketing/home-interactions';
import { SiteFooter } from '@/components/marketing/site-footer';
import { Spotlight } from '@/components/marketing/site-motion';
import { SiteNav } from '@/components/marketing/site-nav';
import { Link } from '@/i18n/navigation';
import { pageAlternates } from '@/lib/page-metadata';
import { siteIdentity } from '@/lib/site-identity';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'company.contact.meta' });
  return {
    title: t('title'),
    description: t('description'),
    alternates: pageAlternates(locale, '/contact'),
  };
}

const TOPICS = ['question', 'broken', 'privacy', 'agency'] as const;

const accent = (chunks: React.ReactNode) => (
  <span className="bg-[linear-gradient(#E3A21A,#E3A21A)] bg-no-repeat [background-position:0_88%] [background-size:100%_34%] motion-safe:animate-sweep">
    {chunks}
  </span>
);

function draft(subject: string, body: string) {
  return `mailto:${siteIdentity.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export default function ContactPage() {
  const t = useTranslations('company.contact');

  return (
    <div className="theme-chalk min-h-screen bg-chalk font-plex text-moss">
      <SiteNav />

      <header className="mx-auto max-w-[90rem] px-5 pb-14 pt-12 md:px-16 md:pt-20">
        <p className="flex items-center gap-3 font-plexmono text-[12px] uppercase tracking-[0.14em] text-moss-muted motion-safe:animate-blur-rise">
          <span aria-hidden className="inline-block h-2 w-2 rotate-45 bg-saffron" />
          {t('eyebrow')}
        </p>
        <h1 className="mt-6 max-w-[14ch] font-display text-[clamp(2.6rem,6.8vw,5.8rem)] font-extrabold leading-[0.98] tracking-[-0.035em] motion-safe:animate-blur-rise motion-safe:[animation-delay:80ms]">
          {t.rich('headline', { accent })}
        </h1>
        <p className="mt-8 max-w-[40rem] text-[18px] leading-[1.65] text-moss-muted motion-safe:animate-blur-rise motion-safe:[animation-delay:160ms]">
          {t('intro')}
        </p>
      </header>

      {/* The address */}
      <section className="mx-auto max-w-[90rem] px-5 md:px-16" aria-label={t('addressLabel')}>
        <div className="rounded-2xl bg-forest p-7 text-chalk motion-safe:animate-blur-rise motion-safe:[animation-delay:240ms] md:p-12">
          <p className="mb-6 font-plexmono text-[12px] uppercase tracking-[0.14em] text-forest-muted">
            {t('addressLabel')}
          </p>
          <CopyAddress
            email={siteIdentity.email}
            labels={{ copy: t('copy'), copied: t('copied'), selected: t('selected'), write: t('write') }}
          />
          <dl className="mt-10 grid gap-6 border-t border-forest-line pt-6 text-[15px] sm:grid-cols-3">
            {(['who', 'where', 'how'] as const).map((k) => (
              <div key={k}>
                <dt className="font-plexmono text-[11px] uppercase tracking-[0.14em] text-forest-muted">{t(`facts.${k}.label`)}</dt>
                <dd className="mt-1.5 leading-relaxed">{t(`facts.${k}.value`)}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Reasons to write, each a pre-filled draft */}
      <section className="mx-auto max-w-[90rem] px-5 py-20 md:px-16 md:py-28" aria-labelledby="topics">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,34rem)] lg:items-end">
          <h2 id="topics" className="font-display text-[clamp(1.9rem,3.6vw,2.8rem)] font-bold leading-tight tracking-[-0.02em]">
            {t('topicsTitle')}
          </h2>
          <p className="text-[16px] leading-relaxed text-moss-muted">{t('topicsIntro')}</p>
        </div>

        <ul className="mt-10 grid gap-4 md:grid-cols-2">
          {TOPICS.map((k, i) => (
            <li key={k}>
              <Reveal delay={i * 80} className="h-full">
                <Spotlight className="h-full rounded-2xl border border-rule bg-chalk-raised transition-[border-color,transform] duration-300 hover:-translate-y-0.5 hover:border-rule-strong">
                  <a href={draft(t(`topics.${k}.subject`), t(`topics.${k}.body`))} className="flex h-full flex-col gap-4 p-7">
                    <span className="flex items-start justify-between gap-4">
                      <span className="font-display text-[23px] font-bold leading-snug">{t(`topics.${k}.title`)}</span>
                      <span
                        aria-hidden
                        className="mt-1 text-[20px] text-moss-muted transition-[transform,color] duration-300 ease-[cubic-bezier(.22,1,.36,1)] group-hover/spot:translate-x-1 group-hover/spot:text-moss rtl:-scale-x-100 rtl:group-hover/spot:-translate-x-1"
                      >
                        →
                      </span>
                    </span>
                    <span className="text-[15.5px] leading-relaxed text-moss-muted">{t(`topics.${k}.summary`)}</span>
                    <span className="mt-auto border-t border-rule pt-4 font-plexmono text-[12px] leading-relaxed text-moss-muted">
                      {t('draftHint')} <bdi className="text-moss">{t(`topics.${k}.subject`)}</bdi>
                    </span>
                  </a>
                </Spotlight>
              </Reveal>
            </li>
          ))}
        </ul>

        <p className="mt-10 text-[15px] text-moss-muted">
          {t.rich('before', {
            privacy: (chunks) => (
              <Link href="/privacy" className="font-medium text-moss underline decoration-saffron decoration-2 underline-offset-4">
                {chunks}
              </Link>
            ),
            pricing: (chunks) => (
              <Link href="/pricing" className="font-medium text-moss underline decoration-saffron decoration-2 underline-offset-4">
                {chunks}
              </Link>
            ),
          })}
        </p>
      </section>

      <SiteFooter />
    </div>
  );
}
