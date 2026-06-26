import { NextResponse } from 'next/server';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase';

export async function GET() {
  const start = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      method: 'HEAD',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const ms = Date.now() - start;

    if (res.status < 500) {
      return NextResponse.json({ ok: true, supabase: 'up', ms });
    }

    return NextResponse.json(
      { ok: false, supabase: 'degraded', status: res.status, ms },
      { status: 503 },
    );
  } catch {
    return NextResponse.json(
      { ok: false, supabase: 'down', ms: Date.now() - start },
      { status: 503 },
    );
  }
}
