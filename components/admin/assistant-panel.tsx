'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ChatBubble } from '@/components/chat/chat-bubble';
import { ChatComposer } from '@/components/chat/chat-composer';
import { ChatMessageList, ChatShell, ChatTypingIndicator } from '@/components/chat/chat-shell';
import { useLang } from '@/components/lang-provider';

type Msg = { id: string; role: string; content: string };
type LinkInfo = { deepLink: string | null; command: string };

export function AssistantPanel() {
  const router = useRouter();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [linkInfo, setLinkInfo] = useState<LinkInfo | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { t } = useLang();

  useEffect(() => {
    fetch('/api/admin/assistant')
      .then(async (r) => {
        if (r.status === 401) {
          router.push('/admin/login');
          router.refresh();
          return null;
        }
        if (!r.ok) throw new Error('load_failed');
        return r.json();
      })
      .then((d) => {
        if (d?.messages) setMessages(d.messages);
        if (d?.conversationId) setConversationId(d.conversationId);
      })
      .catch(() => setLoadError('load_failed'));
  }, [router]);

  // SSE: sync messages from any channel (Telegram → web, web → Telegram)
  useEffect(() => {
    if (!conversationId) return;
    const es = new EventSource(`/api/admin/stream?conversationId=${conversationId}`);
    es.onmessage = (e) => {
      const data = JSON.parse(e.data as string) as { messages: Msg[] };
      if (data.messages) setMessages(data.messages);
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [conversationId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  async function linkTelegram() {
    if (linkInfo) { setLinkInfo(null); return; }
    const res = await fetch('/api/admin/link-telegram', { method: 'POST' });
    const d = await res.json();
    setLinkInfo({ deepLink: d.deep_link ?? null, command: d.command ?? '' });
  }

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    setSending(true);
    setMessages((m) => [...m, { id: `tmp-${Date.now()}`, role: 'user', content: text }]);
    try {
      const res = await fetch('/api/admin/assistant', {
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
      if (!res.ok || !data) throw new Error('agent_error');
      if (data.messages) setMessages(data.messages);
    } catch {
      setLoadError('agent_error');
    } finally {
      setSending(false);
    }
  }

  return (
    <ChatShell
      title="Main Assistant"
      subtitle="Full system control — leads, listings, calendar, subagents"
      heightClass="h-[640px]"
      footer={
        <ChatComposer
          value={input}
          onChange={setInput}
          onSend={() => void send()}
          placeholder="Ask anything or give a command..."
          sendLabel={t.send}
          disabled={sending}
        />
      }
    >
      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2">
        <Button variant="outline" size="sm" onClick={() => void linkTelegram()}>
          {t.link_telegram}
        </Button>
        {linkInfo && (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            {linkInfo.deepLink && (
              <a
                href={linkInfo.deepLink}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-blue-600 underline hover:text-blue-800"
              >
                Open Telegram →
              </a>
            )}
            <span>{t.link_info} <code>{linkInfo.command}</code></span>
          </span>
        )}
      </div>
      {loadError && (
        <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
          Failed to load assistant.
        </p>
      )}
      <ChatMessageList scrollRef={scrollRef}>
        {messages.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Ask anything: "Who are the hottest leads?", "Reschedule viewing X", "Send a follow-up to lead Y"
          </p>
        )}
        {messages.map((m) => (
          <ChatBubble key={m.id} role={m.role} content={m.content} />
        ))}
        {sending && <ChatTypingIndicator />}
      </ChatMessageList>
    </ChatShell>
  );
}
