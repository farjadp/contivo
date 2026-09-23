import { getTranslations } from 'next-intl/server';

import { InstantForm } from '@/components/instant/instant-form';
import { CreditBalance } from '@/components/shared/credit-balance';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'instant' });
  return { title: t('meta.title') };
}

export default async function InstantContentPage() {
  const t = await getTranslations('instant');

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gradient mb-1">{t('title')}</h1>
          <p className="text-muted-foreground text-sm font-medium">{t('subtitle')}</p>
        </div>
        <CreditBalance />
      </div>
      <InstantForm />
    </div>
  );
}
