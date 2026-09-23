import { getLocale, getTranslations } from 'next-intl/server';

import { redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/auth';

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  // Onboarding is a signed-in flow: it is where a new account chooses its
  // first path. Without this it answered 200 to anonymous visitors and both
  // of its links led to a dead end.
  const session = await getSession();
  if (!session) redirect({ href: '/sign-in', locale: await getLocale() });

  const t = await getTranslations('onboarding');

  return (
    <div className="min-h-screen bg-[#FDFCF8] text-[#121212] font-sans selection:bg-[#121212] selection:text-white flex flex-col">
      {/* Editorial aesthetic header, overlapping over the content to keep full layout fluid */}
      <header className="absolute top-0 start-0 w-full p-6 lg:p-12 z-50 pointer-events-none flex items-center justify-between text-[#121212]">
        <div className="flex items-center gap-3">
          {/* Bauhaus inspired accent square */}
          <div className="w-4 h-4 bg-[#C04C36] flex-shrink-0" />
          <bdi className="font-bold text-2xl tracking-tighter uppercase">Contivo</bdi>
        </div>
        <span className="text-xs font-bold tracking-widest uppercase opacity-40 hidden sm:block">
          {t('stage')}
        </span>
      </header>

      <main className="flex-1 w-full h-full flex flex-col">{children}</main>
    </div>
  );
}
