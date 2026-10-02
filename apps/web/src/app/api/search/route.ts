import { NextResponse } from 'next/server';
import { apiFetch, ApiError } from '@/lib/api/client';
import { ACCESS_COOKIE } from '@/lib/api/cookies';
import { cookies } from 'next/headers';

/**
 * Proxy for the topbar search.
 *
 * The search box is a client component and cannot read the httpOnly access token, so the
 * request goes through here to have the token attached server-side.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q') ?? '';
  const accountId = searchParams.get('accountId') ?? '';

  if (q.trim().length < 2 || !accountId) {
    return NextResponse.json({ contacts: [], opportunities: [] });
  }

  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  try {
    const data = await apiFetch(`/core/search?q=${encodeURIComponent(q)}`, {
      token,
      accountId,
    });
    return NextResponse.json(data);
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 500;
    return NextResponse.json({ contacts: [], opportunities: [] }, { status });
  }
}
