'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ChatBubble } from '@/components/chat/chat-bubble';
import { ChatComposer } from '@/components/chat/chat-composer';
import { ChatMessageList, ChatShell, ChatTypingIndicator } from '@/components/chat/chat-shell';
import { useLang } from '@/components/lang-provider';

type Msg = { id: string; role: string; content: string };
type TelegramLinkInfo = {
  command: string;
  deepLink: string | null;
  configured: boolean;
};

export function AdminAssistant() {
  const router = useRouter();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [linkInfo, setLinkInfo] = useState<TelegramLinkInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { t } = useLang();

  useEffect(() => {
    fetch('/api/admin/chat')
      .then(async (r) => {
        if (r.status === 401) {
          router.push('/admin/login');
          router.refresh();
          return null;
        }
        if (!r.ok) throw new Error('chat_load_failed');
        return r.json();
      })
      .then((d) => {
        if (!d) return;
        if (d.conversationId) setConversationId(d.conversationId);
        if (d.messages) setMessages(d.messages);
      })
      .catch(() => setLoadError('chat_load_failed'));
  }, [router]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    setSending(true);
    setMessages((m) => [...m, { id: `tmp-${Date.now()}`, role: 'user', content: text }]);
    try {
      const res = await fetch('/api/admin/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text })
      });
      if (res.status === 401) {
        router.push('/admin/login');
        router.refresh();
        return;
      }
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error('admin_chat_failed');
      if (data.conversationId) setConversationId(data.conversationId);
      if (data.messages) setMessages(data.messages);
      else if (data.reply) {
        setMessages((m) => [
          ...m.filter((msg) => !msg.id.startsWith('tmp-')),
          { id: `reply-${Date.now()}`, role: 'assistant', content: data.reply }
        ]);
      }
    } catch {
      setLoadError('chat_load_failed');
    } finally {
      setSending(false);
    }
  }

  async function linkTelegram() {
    const res = await fetch('/api/admin/link-telegram', { method: 'POST' });
    const d = await res.json();
    setLinkInfo({
      command: d.command ?? '',
      deepLink: d.deep_link ?? null,
      configured: Boolean(d.configured)
    });
  }

  return (
    <div className="space-y-3">
      <ChatShell
        title={t.assistant_title}
        subtitle={t.assistant_examples}
        heightClass="h-[640px]"
        headerAction={
          <Button variant="outline" size="sm" onClick={() => void linkTelegram()}>
            {t.link_telegram}
          </Button>
        }
        footer={
          <ChatComposer
            value={input}
            onChange={setInput}
            onSend={() => void send()}
            placeholder={t.assistant_placeholder}
            sendLabel={t.send}
            disabled={sending}
          />
        }
      >
        {linkInfo && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border/80 bg-muted/30 px-4 py-2.5 text-xs">
            <span>{t.link_info}</span>
            <code className="rounded-md bg-background px-2 py-0.5">{linkInfo.command}</code>
            {linkInfo.deepLink && (
              <a
                href={linkInfo.deepLink}
                target="_blank"
                rel="noreferrer"
                className="rounded-md bg-brand px-2.5 py-1 font-medium text-brand-foreground"
              >
                Open bot
              </a>
            )}
            {!linkInfo.configured && (
              <span className="text-red-700">Telegram bot token is missing.</span>
            )}
          </div>
        )}

        {loadError && (
          <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
            Failed to load assistant conversation.
          </p>
        )}

        <ChatMessageList scrollRef={scrollRef}>
          {messages.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">{t.assistant_empty}</p>
          )}
          {messages.map((m) => (
            <ChatBubble key={m.id} role={m.role} content={m.content} />
          ))}
          {sending && <ChatTypingIndicator />}
        </ChatMessageList>
      </ChatShell>
    </div>
  );
}
