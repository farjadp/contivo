import type { Metadata } from 'next';
import { Inter, Space_Grotesk } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const space = Space_Grotesk({ subsets: ['latin'], variable: '--font-space' });

export const metadata: Metadata = {
  title: 'Contivo — The Creative Canvas',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${space.variable} font-sans bg-[#F9F9F9] text-[#121212] antialiased`}>
        {/* یک بافت بسیار ملایم شبیه کاغذ */}
        <div className="fixed inset-0 pointer-events-none opacity-[0.4] z-[-1] bg-[url('https://www.transparenttextures.com/patterns/p6-static.png')]" />
        {children}
      </body>
    </html>
  );
}