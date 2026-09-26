import { redirect } from '@/i18n/navigation';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import ReviewClient from './ReviewClient';
import { getLocale, getTranslations } from 'next-intl/server';

type Props = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function GrowthReviewPage({ searchParams }: Props) {
  const session = await getSession();
  if (!session) redirect({ href: '/sign-in', locale: await getLocale() });

  const resolvedParams = await searchParams;
  const id = resolvedParams.id as string | undefined;

  if (!id) redirect({ href: '/growth', locale: await getLocale() });

  const workspace = await prisma.workspace.findUnique({
    where: { id, userId: session.userId as string },
  });

  if (!workspace) redirect({ href: '/growth', locale: await getLocale() });

  const brandSummary = (workspace.brandSummary as any) || {};
  const t = await getTranslations('growth.review');

  return (
    <div className="max-w-4xl mx-auto py-8 lg:px-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-moss mb-2">{t('title')}</h1>
        <p className="text-moss-muted text-sm">
          {t('subtitle')}
        </p>
      </div>

      <ReviewClient workspace={workspace} summary={brandSummary} />
    </div>
  );
}
