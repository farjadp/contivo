'use server';

import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';

export async function confirmGrowthStrategy(_prevState: any, formData: FormData) {
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };

  const id = formData.get('id') as string;
  const businessSummary = formData.get('businessSummary') as string;
  const audience = formData.get('audience') as string;
  const tone = formData.get('tone') as string;
  const industry = formData.get('industry') as string;

  if (!id) return { error: 'Workspace ID missing' };

  const workspace = await prisma.workspace.findUnique({
    where: { id, userId: session.userId as string },
  });

  if (!workspace) return { error: 'Workspace not found' };

  // Merge the updated fields back into brandSummary
  const currentSummary = workspace.brandSummary as any || {};

  await prisma.workspace.update({
    where: { id },
    data: {
      status: 'READY',
      brandSummary: {
        ...currentSummary,
        businessSummary,
        audience,
        tone,
        industry,
      },
      // In a real app we'd parse and save pillars and persona properly based on user edits
    },
  });

  redirect('/growth');
}
