'use client';

import { useState } from 'react';
import { useLang } from '@/components/lang-provider';

// Optional, ChatGPT-style login: enter an email to receive a magic link that
// persists the conversation + attaches a lead identity. In dev the link is shown
// inline (no mail provider needed).
export function LeadLogin() {
  const { t, lang } = useLang();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);

  async function request() {
    if (!email.trim()) return;
    const res = await fetch('/api/auth/lead-request-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), lang })
    });
    const data = await res.json().catch(() => ({}));
    setSent(true);
    if (data.dev_link) setDevLink(data.dev_link);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-muted-foreground underline-offset-2 hover:underline"
      >
        {t.login}
      </button>
    );
  }

  if (sent) {
    return (
      <div className="text-xs text-muted-foreground">
        {t.login_sent}
        {devLink && (
          <a href={devLink} className="ml-1 block break-all text-sky-600 underline">
            {t.login_dev} {devLink}
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={t.login_email_prompt}
        className="w-44 rounded border px-2 py-1 text-xs outline-none"
      />
      <button
        type="button"
        onClick={() => void request()}
        className="rounded bg-neutral-900 px-2 py-1 text-xs text-white"
      >
        {t.login_send}
      </button>
    </div>
  );
}
