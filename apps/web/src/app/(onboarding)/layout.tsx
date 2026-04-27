export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#FDFCF8] text-[#121212] font-sans selection:bg-[#121212] selection:text-white flex flex-col">
      {/* Editorial aesthetic header, overlapping over the content to keep full layout fluid */}
      <header className="absolute top-0 left-0 w-full p-6 lg:p-12 z-50 pointer-events-none flex items-center justify-between text-[#121212]">
         <div className="flex items-center gap-3">
            {/* Bauhaus inspired accent square */}
            <div className="w-4 h-4 bg-[#C04C36] flex-shrink-0" />
            <span className="font-bold text-2xl tracking-tighter uppercase">Contivo</span>
         </div>
         <span className="text-xs font-bold tracking-widest uppercase opacity-40 hidden sm:block">
            Onboarding &mdash; Setup Workflow
         </span>
      </header>
      
      <main className="flex-1 w-full h-full flex flex-col">
          {children}
      </main>
    </div>
  );
}
