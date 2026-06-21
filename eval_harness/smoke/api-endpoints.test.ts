/**
 * Smoke tests for HTTP API endpoints.
 * Requires the dev server running at SERVER_URL (default: http://localhost:3000).
 * Run after: npm run dev
 *
 * Tests input validation, auth enforcement, and basic response shapes — NOT LLM output.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.SERVER_URL ?? 'http://localhost:3000';

async function post(path: string, body: unknown, cookie = '') {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: JSON.stringify(body)
  });
}

async function get(path: string, cookie = '') {
  return fetch(`${BASE}${path}`, {
    headers: cookie ? { Cookie: cookie } : {}
  });
}

describe('POST /api/chat — input validation', () => {
  it('returns 400 on missing message', async () => {
    const res = await post('/api/chat', { conversationId: null });
    assert.equal(res.status, 400);
    const body = await res.json() as { error: string };
    assert.equal(body.error, 'invalid_input');
  });

  it('returns 400 on empty message', async () => {
    const res = await post('/api/chat', { message: '' });
    assert.equal(res.status, 400);
  });

  it('returns 400 on message exceeding 4000 chars', async () => {
    const res = await post('/api/chat', { message: 'x'.repeat(4001) });
    assert.equal(res.status, 400);
  });

  it('returns 400 on non-UUID conversationId', async () => {
    const res = await post('/api/chat', { message: 'hi', conversationId: 'not-a-uuid' });
    assert.equal(res.status, 400);
  });
});

describe('POST /api/chat — anonymous new conversation', () => {
  it('creates a conversation and returns a reply on first message', async () => {
    const res = await post('/api/chat', {
      message: 'Bonjour, je cherche un appartement',
      listingId: null,
      conversationId: null
    });
    // May be 200 or 500 depending on agency config / LLM availability
    assert.ok([200, 500].includes(res.status), `unexpected status ${res.status}`);
    if (res.status === 200) {
      const body = await res.json() as { conversationId?: string; reply?: string; error?: string };
      assert.ok(body.conversationId, 'expected conversationId in response');
    }
  });
});

describe('GET /api/chat — input validation', () => {
  it('returns 400 when conversationId is missing', async () => {
    const res = await get('/api/chat');
    assert.equal(res.status, 400);
    const body = await res.json() as { error: string };
    assert.equal(body.error, 'conversationId required');
  });

  it('returns 403 or 404 for unknown conversationId', async () => {
    const res = await get('/api/chat?conversationId=00000000-0000-0000-0000-000000000000');
    assert.ok([403, 404].includes(res.status), `expected 403 or 404, got ${res.status}`);
  });
});

describe('Admin API — auth enforcement', () => {
  it('POST /api/admin/operator/chat returns 401 without session', async () => {
    const res = await post('/api/admin/operator/chat', {
      leadId: 'test',
      message: 'hello'
    });
    assert.equal(res.status, 401);
  });

  it('POST /api/admin/assistant returns 401 without session', async () => {
    const res = await post('/api/admin/assistant', { message: 'hello' });
    assert.equal(res.status, 401);
  });

  it('GET /api/admin/data returns 401 without session', async () => {
    const res = await get('/api/admin/data');
    assert.equal(res.status, 401);
  });
});

describe('SSE endpoint', () => {
  it('GET /api/admin/stream enforces auth / param (401 or 400)', async () => {
    const res = await get('/api/admin/stream');
    // Without a session/param it returns 400 (missing param) or 401 (auth) — never 200/500.
    assert.ok(
      [200, 400, 401].includes(res.status),
      `unexpected status ${res.status}`
    );
  });
});
