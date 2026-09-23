import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';

export default function OnboardingWelcomePage() {
  const t = useTranslations('onboarding.welcome');

  return (
    <div className="w-full min-h-screen flex flex-col lg:flex-row">
      {/* Left Column: Intro */}
      <div className="w-full lg:w-[45%] p-8 pt-32 lg:p-16 xl:p-24 flex flex-col justify-center border-b lg:border-b-0 lg:border-e border-[#121212]/10 bg-[#EFECE5]">
        {/*
          The headline is staggered line by line, so each line is its own
          message rather than one sentence sliced in JSX: Persian needs to put
          the italic word on a different line than English does.
        */}
        <h1 className="text-6xl md:text-7xl lg:text-[6rem] font-medium tracking-tighter leading-[0.9] text-[#121212] mb-10 overflow-hidden">
          <div className="animate-in slide-in-from-bottom duration-700 delay-100 fill-mode-both">
            {t('titleLead')}
          </div>
          <div className="animate-in slide-in-from-bottom duration-700 delay-200 fill-mode-both">
            <span className="italic text-[#121212]/50 font-serif font-light">
              {t('titleAccent')}
            </span>
          </div>
          <div className="animate-in slide-in-from-bottom duration-700 delay-300 fill-mode-both">
            {t('titleTail')}
          </div>
        </h1>
        <p className="max-w-md text-xl text-[#121212]/70 leading-relaxed font-medium animate-in fade-in duration-1000 delay-500 fill-mode-both">
          {t('body')}
        </p>
      </div>

      {/* Right Column: Choices */}
      <div className="w-full lg:w-[55%] flex flex-col animate-in fade-in zoom-in duration-1000 delay-300 fill-mode-both">
        {/* Choice 1: Build Workspace */}
        <Link
          href="/growth/new"
          className="group flex-1 p-8 lg:p-16 xl:p-20 flex flex-col justify-between border-b border-[#121212]/10 bg-[#FDFCF8] hover:bg-[#D9E2DC] transition-colors duration-500 ease-out cursor-pointer"
        >
          <div className="flex justify-between items-start">
            <span className="text-sm font-bold tracking-widest text-[#121212]/50 group-hover:text-[#121212] transition-colors uppercase">
              {t('workspaceIndex')}
            </span>
            {/* The arrow points forward, so it turns with the text direction.
                The flip lives on the wrapper because the icon's own transform
                is already spoken for by the hover rotation. */}
            <div className="w-14 h-14 rounded-full border border-[#121212]/20 flex items-center justify-center group-hover:bg-[#121212] group-hover:text-white transition-all duration-500 rtl:rotate-180">
              <ArrowRight className="w-6 h-6 group-hover:-rotate-45 transition-transform duration-500" />
            </div>
          </div>
          <div className="mt-20 lg:mt-0">
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-medium tracking-tighter mb-4 group-hover:translate-x-6 transition-transform duration-500 will-change-transform">
              {t('workspaceTitle')}
            </h2>
            <p className="text-lg md:text-xl text-[#121212]/50 max-w-sm group-hover:translate-x-6 transition-transform duration-500 delay-75 group-hover:text-[#121212]/80 will-change-transform">
              {t('workspaceBody')}
            </p>
          </div>
        </Link>

        {/* Choice 2: Instant Content */}
        <Link
          href="/instant"
          className="group flex-1 p-8 lg:p-16 xl:p-20 flex flex-col justify-between bg-[#FDFCF8] hover:bg-[#EBE2D5] transition-colors duration-500 ease-out cursor-pointer"
        >
          <div className="flex justify-between items-start">
            <span className="text-sm font-bold tracking-widest text-[#121212]/50 group-hover:text-[#121212] transition-colors uppercase">
              {t('instantIndex')}
            </span>
            <div className="w-14 h-14 rounded-full border border-[#121212]/20 flex items-center justify-center group-hover:bg-[#121212] group-hover:text-white transition-all duration-500 rtl:rotate-180">
              <ArrowRight className="w-6 h-6 group-hover:-rotate-45 transition-transform duration-500" />
            </div>
          </div>
          <div className="mt-20 lg:mt-0">
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-medium tracking-tighter mb-4 group-hover:translate-x-6 transition-transform duration-500 will-change-transform">
              {t('instantTitle')}
            </h2>
            <p className="text-lg md:text-xl text-[#121212]/50 max-w-sm group-hover:translate-x-6 transition-transform duration-500 delay-75 group-hover:text-[#121212]/80 will-change-transform">
              {t('instantBody')}
            </p>
          </div>
        </Link>
      </div>
    </div>
  );
}
