import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { API_BASE } from '@/lib/api/client';
import { ACCESS_COOKIE } from '@/lib/api/cookies';

/**
 * CNT-11 / CNT-43 — export proxy.
 *
 * GET is a plain link the browser downloads, carrying the current filter and the chosen
 * columns; POST carries a selection of ids, which is too large for a URL. Either way the
 * token is attached here, server-side, and the API's response body is streamed straight
 * through rather than buffered, so a 50,000-contact export does not sit in memory before
 * it starts.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get('accountId');
  if (!accountId) return NextResponse.json({ error: 'accountId is required' }, { status: 400 });

  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  // Forward the filters, but never the accountId — that travels as a header.
  const forwarded = new URLSearchParams(searchParams);
  forwarded.delete('accountId');

  const upstream = await fetch(`${API_BASE}/contacts/export?${forwarded}`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Account-Id': accountId },
  });
  return relay(upstream);
}

export async function POST(req: Request) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { accountId?: string } | null;
  if (!body?.accountId) return NextResponse.json({ error: 'accountId is required' }, { status: 400 });
  const { accountId, ...rest } = body;

  const upstream = await fetch(`${API_BASE}/contacts/export`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'X-Account-Id': accountId, 'Content-Type': 'application/json' },
    body: JSON.stringify(rest),
  });
  return relay(upstream);
}

async function relay(upstream: Response) {
  if (!upstream.ok || !upstream.body) {
    const payload = await upstream.json().catch(() => null);
    const message = (payload as { error?: { message?: string } })?.error?.message ?? 'Export failed';
    return NextResponse.json({ error: message }, { status: upstream.status });
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'text/csv; charset=utf-8',
      'Content-Disposition': upstream.headers.get('Content-Disposition') ?? 'attachment; filename="contacts.csv"',
      'Cache-Control': 'no-store',
    },
  });
}
