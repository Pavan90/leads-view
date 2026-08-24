import { NextResponse } from 'next/server'
import leads from '@/data/leads.json'
import { baseUrl, normalizeList, type UpstreamEnv } from '@/lib/upstream'

/**
 * GET /api/leads — the paged lead list.
 *
 * ── Going live ────────────────────────────────────────────────────────
 * Set the base URL in `.env.local` and this route calls the real API; with
 * nothing set it serves `data/leads.json`, so no code change is needed:
 *
 *   LEADS_API_URL_PROD=https://api.example.com
 *
 * Adjust `upstreamRequest` below if your path or query names differ. The
 * response is passed through `normalizeList`, which already accepts rows
 * under `items` / `data` / `results` / `records` (or a bare array) and a
 * cursor under `continuationToken` / `nextToken` / `cursor`. Field-name
 * differences are handled by the alias tables in `lib/upstream.ts` — add a
 * spelling there rather than editing this file.
 * ─────────────────────────────────────────────────────────────────────
 */

/** The upstream call. Path and query names live here and nowhere else. */
function upstreamRequest(root: string, params: URLSearchParams, environment: UpstreamEnv) {
  const query = new URLSearchParams({
    pageSize: params.get('pageSize') ?? '25',
    startTime: params.get('startTime') ?? '0',
    endTime: params.get('endTime') ?? String(Date.now()),
  })
  const token = params.get('continuationToken')
  if (token) query.set('continuationToken', token)
  return { url: `${root}/getleads?${query}`, environment }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const environment = (searchParams.get('environment') || 'Prod') as UpstreamEnv
  const root = baseUrl(environment)

  if (root) {
    const { url } = upstreamRequest(root, searchParams, environment)
    const response = await fetch(url, {
      headers: {
        // The browser sends the token this route was called with; forward it.
        Authorization: request.headers.get('authorization') ?? '',
        accept: 'application/json',
      },
      cache: 'no-store',
    })
    if (!response.ok) {
      return NextResponse.json(
        { error: 'Upstream leads request failed', status: response.status },
        { status: response.status },
      )
    }
    const { items, continuationToken, count } = normalizeList(await response.json())
    return NextResponse.json({ items, continuationToken, count: count ?? items.length, environment })
  }

  // ── Mock path: served only while no LEADS_API_URL* is configured. ──
  const page = Number(searchParams.get('continuationToken')?.replace('page-', '') || 0)
  const pageSize = Math.min(Number(searchParams.get('pageSize') || 25), 100)
  const start = page * pageSize
  // Run the fixture through the same normaliser as live data, so the two
  // paths cannot drift apart.
  const { items } = normalizeList(leads.slice(start, start + pageSize))
  return NextResponse.json({
    items,
    continuationToken: start + pageSize < leads.length ? `page-${page + 1}` : null,
    count: leads.length,
    environment,
  })
}
