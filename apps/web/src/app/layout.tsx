import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { Inter, JetBrains_Mono, Space_Grotesk } from 'next/font/google';
import { GlobalHeader } from '@/components/layout/global-header';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const space = Space_Grotesk({ subsets: ['latin'], variable: '--font-space' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: 'Contivo — Marketing on autopilot',
  description:
    'Contivo turns your website into brand memory, competitive intelligence and a publishing autopilot: it writes, reviews and posts for you, on a schedule you set.',
};

const isClerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${space.variable} ${mono.variable} font-sans bg-[#F9F9F9] text-[#121212] antialiased`}>
        {isClerkEnabled ? (
          <ClerkProvider>
            {/* Ambient light baseline */}
            <div className="fixed inset-0 pointer-events-none opacity-[0.6] z-[-1] bg-[radial-gradient(circle_at_50%_0%,_#ffffff_0%,_transparent_70%)]" />

            <GlobalHeader />

            {children}
          </ClerkProvider>
        ) : (
          <>
            <div className="fixed inset-0 pointer-events-none opacity-[0.6] z-[-1] bg-[radial-gradient(circle_at_50%_0%,_#ffffff_0%,_transparent_70%)]" />

            <GlobalHeader />

            {children}
          </>
        )}
      </body>
    </html>
  );
}
