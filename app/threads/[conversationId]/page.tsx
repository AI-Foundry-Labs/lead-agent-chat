import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { getLeadIdFromCookies } from '@/lib/auth';
import { assertLeadOwnsConversation } from '@/lib/conversation-access';
import { getListingById } from '@/lib/db';
import { ChatPanel } from '@/components/chat/chat-panel';
import { getLang } from '@/lib/i18n-server';
import { getDict } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export default async function ThreadPage({
  params
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const leadId = await getLeadIdFromCookies();
  if (!leadId) redirect('/login?next=/threads');

  const { conversationId } = await params;
  let conversation;
  try {
    conversation = await assertLeadOwnsConversation(conversationId, leadId);
  } catch {
    notFound();
  }

  const lang = await getLang();
  const t = getDict(lang);
  const listing = conversation.listing_id
    ? await getListingById(conversation.listing_id)
    : null;
  const title = listing
    ? lang === 'en'
      ? listing.title_en
      : listing.title
    : t.threads_untitled;
  const greeting = listing ? t.greeting(title) : t.threads_resume_greeting;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:py-10">
      <div className="mb-6 flex items-center justify-between gap-4">
        <Link
          href="/threads"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden />
          {t.threads_back}
        </Link>
        {listing && (
          <Link
            href={`/listings/${listing.id}`}
            className="truncate text-sm text-brand underline-offset-2 hover:underline"
          >
            {title}
          </Link>
        )}
      </div>

      <header className="mb-6 space-y-1">
        <h1 className="font-display text-2xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{t.threads_resume_hint}</p>
      </header>

      <ChatPanel
        listingId={conversation.listing_id ?? ''}
        greeting={greeting}
        initialConversationId={conversation.id}
        showGreeting={false}
      />
    </main>
  );
}
