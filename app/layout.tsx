import type { Metadata, Viewport } from 'next';
import { Share_Tech_Mono } from 'next/font/google';
import './globals.css';

const shareTechMono = Share_Tech_Mono({ weight: '400', subsets: ['latin'], display: 'swap', variable: '--font-share-tech-mono' });

export const metadata: Metadata = {
  title: 'Admiralty Ledger',
  description: 'High Naval Admiralty management simulation — DEFCON-style tactical vectors.',
};

export const viewport: Viewport = { themeColor: '#050811', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={shareTechMono.variable}>
      <body className="bg-void font-mono text-slate-300 antialiased">{children}</body>
    </html>
  );
}
