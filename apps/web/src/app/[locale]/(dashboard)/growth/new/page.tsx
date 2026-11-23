/**
 * New workspace: server shell. It exists to log STEP_VIEWED 'new' (spec
 * first-post B §7); the form itself is the client component it renders,
 * moved unchanged. The (dashboard) layout already guards the session.
 */
import { getLocale } from 'next-intl/server';

import { redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/auth';
import { logStepView } from '@/lib/step-view';

import { NewWorkspaceForm } from './_components/NewWorkspaceForm';

export default async function NewWorkspacePage() {
  const session = await getSession();
  if (!session) redirect({ href: '/sign-in', locale: await getLocale() });

  logStepView(session.userId, 'new');

  return <NewWorkspaceForm />;
}
