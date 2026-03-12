import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSession();

  // If the user isn't logged in, redirect to the sign-in page
  if (!user) {
    redirect('/sign-in?redirectUrl=/admin');
  }

  // NOTE: For local dev, we allow any logged-in user to access the admin page.
  // In production, we would check `user.role === 'ADMIN'`.

  return (
    <div className="flex min-h-screen w-full bg-[#F9F9F9]">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 border-r border-gray-200 bg-white shadow-sm p-6 hidden md:block">
        <h2 className="text-xl font-bold tracking-tight mb-8 text-[#121212]">Contivo Admin</h2>
        <nav className="space-y-2">
          <Link href={"/admin" as any} className="block px-4 py-2 rounded-md bg-gray-100 text-sm font-medium">
            Dashboard
          </Link>
          <Link href={"/admin/users" as any} className="block px-4 py-2 rounded-md text-gray-600 hover:bg-gray-50 text-sm font-medium transition-colors">
            Users & Credits
          </Link>
          <Link href={"/admin/content" as any} className="block px-4 py-2 rounded-md text-gray-600 hover:bg-gray-50 text-sm font-medium transition-colors">
            Content Logs
          </Link>
          <div className="mt-8 pt-6 border-t border-gray-100">
            <Link href={"/" as any} className="block px-4 py-2 text-sm font-medium text-gray-500 hover:text-black">
              ← Back to App
            </Link>
            <form action={async () => {
              'use server';
              const { logout } = await import('@/app/actions/auth');
              await logout();
            }}>
              <button type="submit" className="w-full text-left mt-2 block px-4 py-2 text-sm font-medium text-red-500 hover:text-red-600 transition-colors">
                Sign out
              </button>
            </form>
          </div>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-8 overflow-y-auto">
        <div className="max-w-5xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
