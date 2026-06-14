'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { ChatBubble } from '@/components/chat/chat-bubble';
import { ChatComposer } from '@/components/chat/chat-composer';
import { ChatMessageList, ChatShell, ChatTypingIndicator } from '@/components/chat/chat-shell';
import { addPendingConversationId } from '@/components/chat/pending-conversation-ids';
import { useLang } from '@/components/lang-provider';
import { formatSlot } from '@/lib/format';

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
  greeting,
  initialConversationId = null,
  trackForClaim = false,
  showGreeting = true
}: {
  listingId: string;
  greeting: string;
  /** Resume an existing thread (threads page). Listing page omits this. */
  initialConversationId?: string | null;
  /** Queue anonymous chats for post-login claim (listing quick chat). */
  trackForClaim?: boolean;
  showGreeting?: boolean;
}) {
  const [conversationId, setConversationId] = useState<string | null>(
    initialConversationId
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [viewing, setViewing] = useState<Snapshot['viewing']>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(Boolean(initialConversationId));
  const scrollRef = useRef<HTMLDivElement>(null);
  const { t, lang } = useLang();

  useEffect(() => {
    if (initialConversationId) {
      // Explicit conversation (e.g. threads page) — load directly.
      setConversationId(initialConversationId);
      setLoading(true);
      fetch(`/api/chat?conversationId=${initialConversationId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data) return;
          setMessages(data.messages ?? []);
          setMode(data.conversation?.mode ?? null);
          setViewing(data.viewing ?? null);
        })
        .finally(() => setLoading(false));
    } else {
      // Anonymous listing page — try to restore from guest cookie via server.
      fetch(`/api/chat?listingId=${encodeURIComponent(listingId)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data?.conversation?.id) return;
          setConversationId(data.conversation.id);
          setMessages(data.messages ?? []);
          setMode(data.conversation?.mode ?? null);
          setViewing(data.viewing ?? null);
        });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialConversationId]);

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
      if (!res.ok) {
        console.error('[chat] POST /api/chat', res.status, data);
      }
      if (data.conversationId && !conversationId) {
        setConversationId(data.conversationId);
        if (trackForClaim) addPendingConversationId(data.conversationId);
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
            content: 'Erreur, réessayez.'
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
          disabled={sending}
        />
      }
    >
      <ChatMessageList scrollRef={scrollRef}>
        {showGreeting && <ChatBubble role="assistant" content={greeting} />}
        {loading && <ChatTypingIndicator />}
        {(() => {
          // Find index of last assistant message to inject viewing badge after it
          const lastAssistantIdx = messages.reduce(
            (last, m, i) => (m.role === 'assistant' && m.content ? i : last),
            -1
          );
          return messages.map((m, i) => (
            <div key={m.id}>
              {Array.isArray(m.tool_calls) && m.tool_calls.length > 0 && (
                <p className="mb-1.5 text-center text-[11px] text-muted-foreground">
                  {m.tool_calls.map((tc) => tc.toolName).filter(Boolean).join(', ')}
                </p>
              )}
              {m.content && <ChatBubble role={m.role} content={m.content} />}
              {viewing && i === lastAssistantIdx && (
                <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                  {t.viewing_confirmed} — {formatSlot(viewing.slot, lang === 'en' ? 'en' : 'fr')}
                </div>
              )}
            </div>
          ));
        })()}
        {sending && <ChatTypingIndicator />}
        {mode === 'manual' && (
          <Badge variant="warning" className="mx-auto block w-fit">
            {t.manual_banner}
          </Badge>
        )}
      </ChatMessageList>
    </ChatShell>
  );
}
