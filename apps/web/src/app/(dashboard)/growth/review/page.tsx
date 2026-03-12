import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import ReviewClient from './ReviewClient';

type Props = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function GrowthReviewPage({ searchParams }: Props) {
  const session = await getSession();
  if (!session) redirect('/sign-in');

  const resolvedParams = await searchParams;
  const id = resolvedParams.id as string | undefined;

  if (!id) redirect('/growth');

  const workspace = await prisma.workspace.findUnique({
    where: { id, userId: session.userId as string },
  });

  if (!workspace) redirect('/growth');

  const brandSummary = (workspace.brandSummary as any) || {};

  return (
    <div className="max-w-4xl mx-auto py-8 lg:px-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-[#121212] mb-2">Here’s what we found</h1>
        <p className="text-gray-500 text-sm">
          We scanned your website and drafted your primary content strategy. Review, edit, and confirm these details.
        </p>
      </div>

      <ReviewClient workspace={workspace} summary={brandSummary} />
    </div>
  );
}
