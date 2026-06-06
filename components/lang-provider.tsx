'use client';

import { createContext, useContext, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  getDict,
  LANG_COOKIE,
  type Dict,
  type Lang
} from '@/lib/i18n';

type LangContextValue = { lang: Lang; t: Dict; setLang: (l: Lang) => void };

const LangContext = createContext<LangContextValue | null>(null);

export function LangProvider({
  initialLang,
  children
}: {
  initialLang: Lang;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [lang, setLangState] = useState<Lang>(initialLang);

  const setLang = (l: Lang) => {
    setLangState(l);
    // Persist for server components, then refresh so listing content re-renders.
    document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=${60 * 60 * 24 * 365}`;
    router.refresh();
  };

  return (
    <LangContext.Provider value={{ lang, t: getDict(lang), setLang }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang(): LangContextValue {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useLang must be used within LangProvider');
  return ctx;
}
