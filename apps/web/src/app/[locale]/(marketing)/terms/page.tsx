import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { LegalDocument } from '@/components/marketing/legal-document';
import { pageAlternates } from '@/lib/page-metadata';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'legal.terms.meta' });
  return {
    title: t('title'),
    description: t('description'),
    alternates: pageAlternates(locale, '/terms'),
  };
}

export default function TermsPage() {
  return <LegalDocument doc="terms" />;
}
