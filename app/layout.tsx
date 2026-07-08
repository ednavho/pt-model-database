import type { Metadata } from 'next';
import './globals.css';
import Navbar from '@/components/Navbar';

export const metadata: Metadata = {
  title: 'Pseudorandom Model Provenance',
  description: 'Vetted model database and workflow packaging for Pseudorandom',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full bg-white text-zinc-900 antialiased">
        <Navbar />
        <main className="min-h-[calc(100dvh-3.5rem)]">{children}</main>
      </body>
    </html>
  );
}
