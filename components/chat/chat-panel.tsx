'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { ChatBubble } from '@/components/chat/chat-bubble';
import { ChatComposer } from '@/components/chat/chat-composer';
import { ChatMessageList, ChatShell, ChatTypingIndicator } from '@/components/chat/chat-shell';
import { useLang } from '@/components/lang-provider';

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
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    setSending(true);
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
            content: mode === 'manual' ? t.manual_banner : 'Erreur, réessayez.'
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
    <ChatShell
      title={t.chat_title}
      subtitle={t.chat_subtitle}
      footer={
        <ChatComposer
          value={input}
          onChange={setInput}
          onSend={() => void send()}
          placeholder={t.chat_placeholder}
          sendLabel={t.send}
          disabled={sending || mode === 'manual'}
        />
      }
    >
      <ChatMessageList scrollRef={scrollRef}>
        <ChatBubble role="assistant" content={greeting} />
        {messages.map((m) => (
          <div key={m.id}>
            {Array.isArray(m.tool_calls) && m.tool_calls.length > 0 && (
              <p className="mb-1.5 text-center text-[11px] text-muted-foreground">
                {m.tool_calls.map((tc) => tc.toolName).filter(Boolean).join(', ')}
              </p>
            )}
            {m.content && <ChatBubble role={m.role} content={m.content} />}
          </div>
        ))}
        {sending && <ChatTypingIndicator />}
        {viewing && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {t.viewing_confirmed} — {viewing.slot}
          </div>
        )}
        {mode === 'manual' && (
          <Badge variant="warning" className="mx-auto block w-fit">
            {t.manual_banner}
          </Badge>
        )}
      </ChatMessageList>
    </ChatShell>
  );
}
