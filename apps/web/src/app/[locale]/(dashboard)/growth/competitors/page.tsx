import { redirect } from '@/i18n/navigation';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import CompetitorsClient from './CompetitorsClient';
import { getLocale, getTranslations } from 'next-intl/server';

type Props = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function CompetitorsPage({ searchParams }: Props) {
  const session = await getSession();
  if (!session) redirect({ href: '/sign-in', locale: await getLocale() });

  const resolvedParams = await searchParams;
  const id = resolvedParams.id as string | undefined;

  if (!id) redirect({ href: '/growth', locale: await getLocale() });

  const workspace = await prisma.workspace.findUnique({
    where: { id, userId: session.userId as string },
    include: {
      competitors: true
    }
  });

  if (!workspace) redirect({ href: '/growth', locale: await getLocale() });

  const t = await getTranslations('growth.competitors');

  return (
    <div className="max-w-6xl mx-auto py-8 px-4 lg:px-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-[#121212] mb-2">{t('title')}</h1>
        <p className="text-gray-500 text-sm max-w-2xl">
          {t('subtitle', { count: workspace.competitors.length })}
        </p>
      </div>

      <CompetitorsClient workspace={workspace} initialCompetitors={workspace.competitors} />
    </div>
  );
}
