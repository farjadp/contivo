// apps/web/src/app/(dashboard)/growth/[id]/calendar/page.tsx

import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { redirect } from 'next/navigation';
import { CalendarContent } from './CalendarContent';

export const metadata = {
  title: 'Content Calendar | Contivo',
};

export default async function ContentCalendarPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.userId) {
    redirect('/sign-in');
  }

  const { id } = await params;

  const workspace = await prisma.workspace.findUnique({
    where: { id, userId: session.userId },
  });

  if (!workspace) {
    redirect('/dashboard');
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-gray-200 bg-white px-6 md:px-8 py-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#121212]">Publishing Calendar</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage, schedule, and track all your generated content across platforms.
          </p>
        </div>
      </div>
      
      <div className="flex-1 p-6 md:p-8 bg-gray-50/50">
        <CalendarContent workspaceId={workspace.id} />
      </div>
    </div>
  );
}
