import { cache } from 'react';

import { getSession } from '@/lib/auth';
import { getCreditBalance } from '@/lib/credits';
import { isLowBalance } from '@/lib/credit-costs';
import { CreditBalancePill } from '@/components/shared/credit-balance';

import { LowCreditNotice } from './CreditNotice';

/**
 * The account balance on the workspace page. Self-contained (reads its own
 * session and balance) so the page only places it, and once per request even
 * though the pill and the banner both need the number.
 */
const balanceForRequest = cache(async (): Promise<number | null> => {
  const session = await getSession();
  if (!session) return null;
  return getCreditBalance(session.userId as string);
});

/** The balance pill, for the header. */
export async function WorkspaceCreditBalance() {
  const balance = await balanceForRequest();
  if (balance === null) return null;
  return <CreditBalancePill balance={balance} low={isLowBalance(balance)} className="self-start lg:self-end" />;
}

/** The low-balance warning with "Request more credits"; nothing when the balance covers a run. */
export async function WorkspaceCreditBanner({ workspaceId }: { workspaceId: string }) {
  const balance = await balanceForRequest();
  if (balance === null || !isLowBalance(balance)) return null;
  return <LowCreditNotice workspaceId={workspaceId} balance={balance} />;
}
