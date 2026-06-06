import type { Metadata } from 'next';
import Link from 'next/link';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { Toaster } from 'sonner';
import { LangProvider } from '@/components/lang-provider';
import { LangToggle } from '@/components/lang-toggle';
import { getLang } from '@/lib/i18n-server';
import { dict } from '@/lib/i18n';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Agence Lumière — Assistant immobilier IA',
  description:
    'Parcourez nos biens et discutez avec un assistant IA qui répond, qualifie et organise vos visites.'
};

export default async function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  const lang = await getLang();

  return (
    <html lang={lang}>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <LangProvider initialLang={lang}>
          <header className="flex items-center justify-between border-b px-4 py-3">
            <Link href="/" className="text-sm font-semibold">
              {dict[lang].brand}
            </Link>
            <LangToggle />
          </header>
          {children}
          <Toaster />
        </LangProvider>
      </body>
    </html>
  );
}
