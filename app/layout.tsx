import type { Metadata } from 'next';
import { Fraunces, Source_Sans_3, Geist_Mono } from 'next/font/google';
import './globals.css';
import { Toaster } from 'sonner';
import { LangProvider } from '@/components/lang-provider';
import { SiteHeader } from '@/components/layout/site-header';
import { getLang } from '@/lib/i18n-server';

const fraunces = Fraunces({
  variable: '--font-fraunces',
  subsets: ['latin', 'vietnamese'],
  display: 'swap'
});

const sourceSans = Source_Sans_3({
  variable: '--font-source-sans',
  subsets: ['latin', 'vietnamese'],
  display: 'swap'
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin']
});

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
      <body
        className={`${fraunces.variable} ${sourceSans.variable} ${geistMono.variable} min-h-[100dvh] antialiased`}
      >
        <LangProvider initialLang={lang}>
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-brand focus:px-4 focus:py-2 focus:text-brand-foreground"
          >
            Skip to content
          </a>
          <SiteHeader lang={lang} />
          <div id="main-content">{children}</div>
          <Toaster position="bottom-center" richColors />
        </LangProvider>
      </body>
    </html>
  );
}
