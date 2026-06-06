'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useLang } from '@/components/lang-provider';

type Msg = { id: string; role: string; content: string };

export function AdminAssistant() {
  const router = useRouter();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [linkInfo, setLinkInfo] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { t } = useLang();

  // Bootstrap: fetch (or create) the assistant conversation + thread.
  useEffect(() => {
    fetch('/api/admin/chat')
      .then((r) => r.json())
      .then((d) => {
        if (d.conversationId) setConversationId(d.conversationId);
        if (d.messages) setMessages(d.messages);
      })
      .catch(() => {});
  }, []);

  // Sync via the shared conversation SSE stream (web + Telegram dual-client).
  useEffect(() => {
    if (!conversationId) return;
    const es = new EventSource(`/api/chat/stream?conversationId=${conversationId}`);
    es.onmessage = (e) => {
      const snap = JSON.parse(e.data);
      if (snap.messages) setMessages(snap.messages);
    };
    return () => es.close();
  }, [conversationId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, sending]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    setSending(true);
    setMessages((m) => [...m, { id: `tmp-${Date.now()}`, role: 'user', content: text }]);
    try {
      await fetch('/api/admin/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text })
      });
    } finally {
      setSending(false);
    }
  }

  async function linkTelegram() {
    const res = await fetch('/api/admin/link-telegram', { method: 'POST' });
    const d = await res.json();
    setLinkInfo(d.command ?? null);
  }

  async function logout() {
    await fetch('/api/auth/admin/logout', { method: 'POST' });
    router.push('/admin/login');
    router.refresh();
  }

  return (
    <Card className="flex h-[640px] flex-col p-0">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <p className="text-sm font-medium">{t.assistant_title}</p>
          <p className="text-xs text-muted-foreground">{t.assistant_examples}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void linkTelegram()}>
            {t.link_telegram}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void logout()}>
            {t.logout}
          </Button>
        </div>
      </div>

      {linkInfo && (
        <p className="border-b bg-muted/50 px-4 py-2 text-xs">
          {t.link_info}{' '}
          <code className="rounded bg-background px-1">{linkInfo}</code>
        </p>
      )}

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <p className="text-center text-sm text-muted-foreground">
            {t.assistant_empty}
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
          >
            <div
              className={
                m.role === 'user'
                  ? 'max-w-[80%] whitespace-pre-wrap rounded-2xl bg-neutral-900 px-3 py-2 text-sm text-white'
                  : 'max-w-[80%] whitespace-pre-wrap rounded-2xl bg-muted px-3 py-2 text-sm'
              }
            >
              {m.content}
            </div>
          </div>
        ))}
        {sending && <p className="text-center text-xs text-muted-foreground">…</p>}
      </div>

      <div className="flex gap-2 border-t p-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={t.assistant_placeholder}
          className="flex-1 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-300"
        />
        <Button onClick={() => void send()} disabled={sending || !input.trim()}>
          {t.send}
        </Button>
      </div>
    </Card>
  );
}
