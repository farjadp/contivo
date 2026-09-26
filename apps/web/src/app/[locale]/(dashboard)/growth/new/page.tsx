'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ArrowLeft, Globe, ArrowRight } from 'lucide-react';
import { createNewWorkspace } from '@/app/actions/growth';

const initialState = {
  error: '',
};

export default function NewWorkspaceUrlFirstPage() {
  const t = useTranslations('growth.new');
  const [state, formAction, pending] = useActionState(createNewWorkspace as any, initialState);

  return (
    <div className="w-full h-full min-h-[80vh] flex flex-col lg:flex-row bg-chalk-raised text-moss overflow-hidden rounded-[32px] border border-moss/10">
      
      {/* Left Column */}
      <div className="w-full lg:w-[45%] p-8 lg:p-12 xl:p-16 flex flex-col justify-between border-b lg:border-b-0 lg:border-e border-moss/10 bg-chalk">
        <div>
           <Link
             href="/growth"
             className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase opacity-50 hover:opacity-100 transition-opacity mb-16"
           >
             <ArrowLeft className="h-4 w-4 rtl:rotate-180" /> {t('back')}
           </Link>

           <h1 className="text-5xl md:text-6xl font-medium tracking-tighter leading-[1] text-moss mb-8">
             <div className="animate-in slide-in-from-bottom duration-700 delay-100 fill-mode-both">{t('titleTop')}</div>
             <div className="animate-in slide-in-from-bottom duration-700 delay-200 fill-mode-both">
                 <span className="italic text-moss/50 font-serif font-light">{t('titleAccent')}</span>
             </div>
           </h1>
           
           <p className="text-lg text-moss/70 leading-relaxed font-medium max-w-sm animate-in fade-in duration-1000 delay-300 fill-mode-both">
             {t('lead')}
           </p>
        </div>

        <div className="hidden lg:flex items-center gap-3 mt-12 animate-in fade-in duration-1000 delay-500 fill-mode-both">
            <div className="w-3 h-3 rotate-45 bg-saffron" />
            <span className="text-xs font-bold tracking-widest uppercase opacity-40">{t('systemInit')}</span>
        </div>
      </div>

      {/* Right Column: Form */}
      <div className="w-full lg:w-[55%] p-8 lg:p-12 xl:p-24 flex flex-col justify-center bg-chalk-raised animate-in fade-in zoom-in duration-1000 delay-300 fill-mode-both">
        <form action={formAction as any} className="w-full max-w-md mx-auto space-y-10">
          
          <div className="space-y-4">
             {/* The step number stays inside the sentence rather than being a
                 separate node, so Persian can put it where it belongs. */}
             <label className="flex items-center gap-3 text-xs font-bold tracking-widest uppercase text-moss/60">
                {t.rich('nameLabel', { num: (chunks) => <span className="text-moss">{chunks}</span> })}
             </label>
             <input
               type="text"
               name="name"
               required
               className="w-full bg-transparent border-b-2 border-moss/20 py-4 text-2xl md:text-3xl text-moss placeholder-moss-muted/70 focus:outline-none focus:border-saffron transition-colors rounded-none"
               placeholder={t('namePlaceholder')}
             />
          </div>

          <div className="space-y-4">
             <label className="flex items-center gap-3 text-xs font-bold tracking-widest uppercase text-moss/60">
                {t.rich('urlLabel', { num: (chunks) => <span className="text-moss">{chunks}</span> })}
             </label>
             <div className="relative">
               <Globe className="absolute start-0 top-1/2 -translate-y-1/2 text-moss/20 h-6 w-6 md:h-8 md:w-8" />
               <input
                 type="url"
                 name="url"
                 required
                 className="w-full bg-transparent border-b-2 border-moss/20 py-4 ps-10 md:ps-12 text-2xl md:text-3xl text-moss placeholder-moss-muted/70 focus:outline-none focus:border-saffron transition-colors rounded-none"
                 placeholder={t('urlPlaceholder')}
               />
             </div>
          </div>

          {state?.error && (
            <div className="bg-red-50 text-red-700 p-4 text-sm font-medium border border-red-200">
              {state.error}
            </div>
          )}

          <div className="pt-8 inline-block w-full">
            <button
               type="submit"
               disabled={pending}
               className="group w-full bg-moss text-chalk py-5 px-8 flex items-center justify-between hover:bg-moss-700 transition-colors duration-500 disabled:opacity-50 rounded-none"
            >
               <span className="text-sm font-bold tracking-widest uppercase">
                 {pending ? t('submitting') : t('submit')}
               </span>
               <div className="w-10 h-10 rounded-full border border-chalk-raised/20 flex items-center justify-center group-hover:bg-saffron group-hover:text-moss transition-all duration-500">
                  {/* Mirrored, not rotated: the hover already owns `rotate`. */}
                  <ArrowRight className="w-5 h-5 rtl:-scale-x-100 group-hover:-rotate-45 transition-transform duration-500" />
               </div>
            </button>
          </div>
          
          <p className="text-xs text-moss/40 font-medium leading-relaxed mt-4">
             {t('note')}
          </p>
        </form>
      </div>
    </div>
  );
}
