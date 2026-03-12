export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#fafaf8] flex flex-col">
      {/* Minimal header */}
      <header className="flex items-center h-14 px-8 border-b border-gray-100">
        <span className="font-bold text-lg tracking-tight text-[#121212]">Contivo</span>
      </header>
      <div className="flex-1 flex items-start justify-center py-16 px-4">
        {children}
      </div>
    </div>
  );
}
