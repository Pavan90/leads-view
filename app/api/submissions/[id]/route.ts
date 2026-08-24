import { NextResponse } from 'next/server'
import leads from '@/data/leads.json'
import type { Lead } from '@/lib/leads-store'
import { baseUrl, normalizeLead, normalizeSubmission, type RawRecord, type UpstreamEnv } from '@/lib/upstream'

/**
 * GET /api/submissions/:id — one submission, with the detail the list
 * endpoint omits. Backs the search-by-ID lookup and the row drawer.
 *
 * ── Going live ────────────────────────────────────────────────────────
 * Same switch as the list route: set LEADS_API_URL* in `.env.local` and
 * this calls the real endpoint. Change the path in `upstreamUrl` if yours
 * is not `/submissionbyid`.
 *
 * The response goes through `normalizeSubmission`, so you do not need to
 * match the mock's shape. Whatever the API returns beyond the core lead
 * fields is rendered in the drawer's "Submission details" list, and an
 * array under `history` / `timeline` / `events` / `activity` becomes the
 * activity timeline. Extra fields appear with no code change; missing ones
 * are simply omitted.
 *
 * A 404 from upstream is passed through as a 404 — the UI renders its
 * "Submission not found" state from that status specifically.
 * ─────────────────────────────────────────────────────────────────────
 */

/** Adjust to match the real path/query. */
const upstreamUrl = (root: string, id: string) =>
  `${root}/submissionbyid?submissionId=${encodeURIComponent(id)}`

/** Mock-only: makes the loading state visible locally. Ignored when live. */
const MOCK_LATENCY_MS = 450

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { searchParams } = new URL(request.url)
  const environment = (searchParams.get('environment') || 'Prod') as UpstreamEnv
  const root = baseUrl(environment)

  if (root) {
    const response = await fetch(upstreamUrl(root, id), {
      headers: {
        Authorization: request.headers.get('authorization') ?? '',
        accept: 'application/json',
      },
      cache: 'no-store',
    })
    if (response.status === 404) {
      return NextResponse.json({ error: 'Submission not found', submissionId: id }, { status: 404 })
    }
    if (!response.ok) {
      return NextResponse.json(
        { error: 'Upstream submission request failed', status: response.status },
        { status: response.status },
      )
    }
    const payload = await response.json()
    // Some APIs wrap the record in an envelope; unwrap a single known key.
    const record = payload?.submission ?? payload?.data ?? payload?.item ?? payload
    return NextResponse.json(normalizeSubmission(record, environment))
  }

  // ── Mock path: served only while no LEADS_API_URL* is configured. ──
  await new Promise((resolve) => setTimeout(resolve, MOCK_LATENCY_MS))

  // Match through the normaliser so the fixture can be swapped for a sample of
  // real payloads without this lookup caring what the fields are called.
  const rows = leads as RawRecord[]
  const match = rows.find((row) => normalizeLead(row).submissionId.toLowerCase() === id.toLowerCase())
  if (!match) {
    return NextResponse.json({ error: 'Submission not found', submissionId: id }, { status: 404 })
  }
  return NextResponse.json(normalizeSubmission({ ...match, ...mockDetail(normalizeLead(match)) }, environment))
}

/* ------------------------------------------------------------------ *
 * Mock detail generation — delete once the real endpoint is wired in.
 * ------------------------------------------------------------------ */

const SOURCES = ['Web form', 'Landing page', 'Partner API', 'Import']
const OWNERS = ['A. Rivera', 'J. Okafor', 'M. Lindqvist', 'Unassigned']

/** Stable pseudo-random pick so a given submission always reads the same. */
function hash(value: string) {
  let out = 0
  for (let i = 0; i < value.length; i++) out = (out * 31 + value.charCodeAt(i)) >>> 0
  return out
}

function mockDetail(lead: Lead) {
  const seed = hash(lead.submissionId)
  const updatedAt = new Date(lead.updatedAt)
  const createdAt = new Date(updatedAt.getTime() - (seed % 72) * 3_600_000)
  return {
    detail: {
      source: SOURCES[seed % SOURCES.length],
      formName: `${Object.values(lead.dynamic)[0] ?? 'General'} enquiry`,
      formVersion: `v${(seed % 4) + 1}.${seed % 10}`,
      assignedTo: OWNERS[(seed >>> 3) % OWNERS.length],
      score: 40 + (seed % 61),
      createdAt: createdAt.toISOString(),
      consent: (seed & 1) === 0,
      ipAddress: `203.0.${seed % 256}.${(seed >>> 8) % 256}`,
      utmSource: ['google', 'linkedin', 'direct', 'newsletter'][(seed >>> 5) % 4],
      utmMedium: ['cpc', 'organic', 'referral', 'email'][(seed >>> 7) % 4],
    },
    history: [
      { at: createdAt.toISOString(), event: 'Submission received' },
      { at: new Date(createdAt.getTime() + 900_000).toISOString(), event: 'Routed to sales queue' },
      { at: lead.updatedAt, event: `Status set to ${lead.status}` },
    ],
  }
}
