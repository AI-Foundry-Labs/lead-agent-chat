'use client';

import { useRouter } from 'next/navigation';

const DEV_LEADS = [
  { label: 'Lead 1', email: 'lead1@test.com' },
  { label: 'Lead 2', email: 'lead2@test.com' },
  { label: 'Demo Buyer', email: 'buyer@test.com' }
];

// Renders only in non-production; server component passes IS_DEV as prop
// so the check happens at build time too (no client-side bundle in prod).
export function DevLeadShortcuts({ next = '/' }: { next?: string }) {
  const router = useRouter();

  async function loginAs(email: string) {
    const res = await fetch('/api/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    if (res.ok) {
      router.push(next);
      router.refresh();
    }
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-700">
        Dev — quick login
      </p>
      <div className="flex flex-wrap gap-1.5">
        {DEV_LEADS.map((l) => (
          <button
            key={l.email}
            type="button"
            onClick={() => void loginAs(l.email)}
            className="rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-800 transition hover:bg-amber-100 active:scale-95"
          >
            {l.label}
          </button>
        ))}
      </div>
    </div>
  );
}
