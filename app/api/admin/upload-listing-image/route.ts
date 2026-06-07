import crypto from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { requireAdmin, toAuthResponse } from '@/lib/auth';

export const runtime = 'nodejs';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp']
]);

export async function POST(req: Request) {
  try {
    await requireAdmin();
    const form = await req.formData();
    const file = form.get('file');

    if (!(file instanceof File)) {
      return Response.json({ error: 'missing_file' }, { status: 400 });
    }

    if (file.size === 0) {
      return Response.json({ error: 'empty_file' }, { status: 400 });
    }

    if (file.size > MAX_BYTES) {
      return Response.json({ error: 'file_too_large' }, { status: 400 });
    }

    const ext = ALLOWED_TYPES.get(file.type);
    if (!ext) {
      return Response.json({ error: 'invalid_type' }, { status: 400 });
    }

    const name = `${crypto.randomUUID()}.${ext}`;
    const dir = path.join(process.cwd(), 'public', 'uploads', 'listings');
    await mkdir(dir, { recursive: true });

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(dir, name), buffer);

    return Response.json({ url: `/uploads/listings/${name}` });
  } catch (e) {
    const authRes = toAuthResponse(e);
    if (authRes) return authRes;
    console.error('[admin/upload-listing-image] failed:', e);
    return Response.json({ error: 'upload_failed' }, { status: 500 });
  }
}
