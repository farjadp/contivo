import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import CompetitorsClient from './CompetitorsClient';

type Props = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function CompetitorsPage({ searchParams }: Props) {
  const session = await getSession();
  if (!session) redirect('/sign-in');

  const resolvedParams = await searchParams;
  const id = resolvedParams.id as string | undefined;

  if (!id) redirect('/growth');

  const workspace = await prisma.workspace.findUnique({
    where: { id, userId: session.userId as string },
    include: {
      competitors: true
    }
  });

  if (!workspace) redirect('/growth');

  return (
    <div className="max-w-6xl mx-auto py-8 px-4 lg:px-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-[#121212] mb-2">Competitor Analysis</h1>
        <p className="text-gray-500 text-sm max-w-2xl">
          We found {workspace.competitors.length} potential competitors based on your website data. 
          Review the landscape below and validate them so our AI can design a differentiated strategy.
        </p>
      </div>

      <CompetitorsClient workspace={workspace} initialCompetitors={workspace.competitors} />
    </div>
  );
}
