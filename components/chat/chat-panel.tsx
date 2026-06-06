'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useLang } from '@/components/lang-provider';
import { LeadLogin } from '@/components/chat/lead-login';

type ToolCall = { toolName?: string };
type ChatMessage = {
  id: string;
  role: string;
  content: string;
  tool_calls?: ToolCall[] | null;
};
type Snapshot = {
  mode: string | null;
  messages: ChatMessage[];
  viewing: { listing_id: string; slot: string } | null;
};

export function ChatPanel({
  listingId,
  greeting
}: {
  listingId: string;
  greeting: string;
}) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [viewing, setViewing] = useState<Snapshot['viewing']>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { t } = useLang();

  // Subscribe to server-sent snapshots once a conversation exists.
  useEffect(() => {
    if (!conversationId) return;
    const es = new EventSource(`/api/chat/stream?conversationId=${conversationId}`);
    es.onmessage = (e) => {
      const snap: Snapshot = JSON.parse(e.data);
      setMessages(snap.messages);
      setViewing(snap.viewing);
      setMode(snap.mode);
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
    // Optimistic echo (SSE will reconcile with the persisted thread).
    setMessages((m) => [
      ...m,
      { id: `tmp-${Date.now()}`, role: 'user', content: text }
    ]);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, listingId, message: text })
      });
      const data = await res.json();
      if (data.conversationId && !conversationId) {
        setConversationId(data.conversationId);
      }
      // Render the reply straight from the response so chat works even if the SSE
      // stream is unavailable; the SSE snapshot later reconciles with stable ids.
      if (data.reply) {
        setMessages((m) => [
          ...m,
          { id: `a-${Date.now()}`, role: 'assistant', content: data.reply }
        ]);
      } else if (data.error) {
        setMessages((m) => [
          ...m,
          {
            id: `e-${Date.now()}`,
            role: 'assistant',
            content: '⚠️ ' + (mode === 'manual' ? t.manual_banner : 'Erreur, réessayez.')
          }
        ]);
      }
    } catch {
      // leave optimistic message; user can retry
    } finally {
      setSending(false);
    }
  }

  return (
    <Card className="flex h-[600px] flex-col p-0">
      <div className="flex items-start justify-between gap-2 border-b px-4 py-3">
        <div>
          <p className="text-sm font-medium">{t.chat_title}</p>
          <p className="text-xs text-muted-foreground">{t.chat_subtitle}</p>
        </div>
        <LeadLogin />
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        <Bubble role="assistant" content={greeting} />
        {messages.map((m) => (
          <div key={m.id}>
            {Array.isArray(m.tool_calls) && m.tool_calls.length > 0 && (
              <p className="mb-1 text-center text-[11px] text-muted-foreground">
                ⚙︎ {m.tool_calls.map((t) => t.toolName).filter(Boolean).join(', ')}
              </p>
            )}
            {m.content && <Bubble role={m.role} content={m.content} />}
          </div>
        ))}
        {sending && (
          <p className="text-center text-xs text-muted-foreground">…</p>
        )}
        {viewing && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm">
            ✅ {t.viewing_confirmed} — {viewing.slot}
          </div>
        )}
        {mode === 'manual' && (
          <p className="text-center text-xs text-amber-600">{t.manual_banner}</p>
        )}
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
          placeholder={t.chat_placeholder}
          className="flex-1 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-300"
        />
        <Button onClick={() => void send()} disabled={sending || !input.trim()}>
          {t.send}
        </Button>
      </div>
    </Card>
  );
}

function Bubble({ role, content }: { role: string; content: string }) {
  const isUser = role === 'user';
  return (
    <div className={isUser ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className={
          isUser
            ? 'max-w-[80%] whitespace-pre-wrap rounded-2xl bg-neutral-900 px-3 py-2 text-sm text-white'
            : 'max-w-[80%] whitespace-pre-wrap rounded-2xl bg-muted px-3 py-2 text-sm'
        }
      >
        {content}
      </div>
    </div>
  );
}
