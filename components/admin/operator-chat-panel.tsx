'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChatBubble } from '@/components/chat/chat-bubble';
import { ChatComposer } from '@/components/chat/chat-composer';
import { ChatMessageList, ChatShell, ChatTypingIndicator } from '@/components/chat/chat-shell';
import { useLang } from '@/components/lang-provider';

type Msg = { id: string; role: string; content: string };

export type OperatorScope =
  | { type: 'lead'; leadId: string; title: string }
  | { type: 'anonymous' };

export function OperatorChatPanel({ scope }: { scope: OperatorScope | null }) {
  const router = useRouter();
  const { t } = useLang();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadKey =
    scope?.type === 'anonymous' ? 'anonymous' : scope?.type === 'lead' ? scope.leadId : null;

  const loadChat = useCallback(async () => {
    if (!scope) return;
    const qs =
      scope.type === 'anonymous'
        ? 'scope=anonymous'
        : `lead_id=${encodeURIComponent(scope.leadId)}`;
    const r = await fetch(`/api/admin/operator/chat?${qs}`);
    if (r.status === 401) {
      router.push('/admin/login');
      router.refresh();
      return;
    }
    if (!r.ok) return;
    const d = await r.json();
    setConversationId(d.conversationId ?? null);
    setMessages(d.messages ?? []);
  }, [scope, router]);

  useEffect(() => {
    setMessages([]);
    setConversationId(null);
    void loadChat();
  }, [loadKey, loadChat]);

  // SSE: sync messages in real-time (Telegram → web, handoff auto-briefings, etc.)
  useEffect(() => {
    if (!conversationId) return;
    const es = new EventSource(`/api/admin/stream?conversationId=${conversationId}`);
    es.onmessage = (e) => {
      const data = JSON.parse(e.data as string) as { messages: { id: string; role: string; content: string }[] };
      if (data.messages) setMessages(data.messages);
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [conversationId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  async function send() {
    const text = input.trim();
    if (!text || sending || !scope) return;
    setInput('');
    setSending(true);
    setMessages((m) => [...m, { id: `tmp-${Date.now()}`, role: 'user', content: text }]);
    try {
      const res = await fetch('/api/admin/operator/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          scope.type === 'anonymous'
            ? { scope: 'anonymous', message: text }
            : { scope: 'lead', lead_id: scope.leadId, message: text }
        )
      });
      if (res.status === 401) {
        router.push('/admin/login');
        router.refresh();
        return;
      }
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error('operator_chat_failed');
      if (data.conversationId) setConversationId(data.conversationId);
      if (data.messages) setMessages(data.messages);
      else if (data.reply) {
        setMessages((m) => [
          ...m.filter((msg) => !msg.id.startsWith('tmp-')),
          { id: `reply-${Date.now()}`, role: 'assistant', content: data.reply }
        ]);
      }
    } finally {
      setSending(false);
    }
  }

  if (!scope) {
    return (
      <div className="flex min-h-[480px] items-center justify-center rounded-xl border border-dashed border-border bg-surface/40 p-8 text-sm text-muted-foreground">
        {t.agent_select}
      </div>
    );
  }

  const title =
    scope.type === 'anonymous'
      ? `Operator · ${t.agent_anonymous_title}`
      : `Operator · ${scope.title}`;

  return (
    <ChatShell
      title={title}
      subtitle={t.agent_subtitle}
      heightClass="min-h-[520px]"
      footer={
        <ChatComposer
          value={input}
          onChange={setInput}
          onSend={() => void send()}
          placeholder={t.agent_placeholder}
          sendLabel={t.send}
          disabled={sending}
        />
      }
    >
      <ChatMessageList scrollRef={scrollRef}>
        {messages.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">{t.agent_empty}</p>
        )}
        {messages.map((m) => (
          <ChatBubble key={m.id} role={m.role} content={m.content} />
        ))}
        {sending && <ChatTypingIndicator />}
      </ChatMessageList>
    </ChatShell>
  );
}
