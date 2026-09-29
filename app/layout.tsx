import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Admiralty Ledger',
  description: 'High Naval Admiralty management simulation — DEFCON-style tactical vectors.',
};

export const viewport: Viewport = { themeColor: '#050811', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-void font-mono text-slate-300 antialiased">{children}</body>
    </html>
  );
}
