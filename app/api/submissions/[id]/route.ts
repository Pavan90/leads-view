import { NextResponse } from 'next/server'
import leads from '@/data/leads.json'

/**
 * Mock of the upstream GET /submissionbyid endpoint. It returns the same lead
 * record the list endpoint serves, plus the per-submission detail the list call
 * omits. Swap the body for the real fetch when wiring the live host — the
 * response shape below is what the drawer renders against.
 */

const SOURCES = ['Web form', 'Landing page', 'Partner API', 'Import']
const OWNERS = ['A. Rivera', 'J. Okafor', 'M. Lindqvist', 'Unassigned']

/** Stable pseudo-random pick so a given submission always reads the same. */
function hash(value: string) {
  let out = 0
  for (let i = 0; i < value.length; i++) out = (out * 31 + value.charCodeAt(i)) >>> 0
  return out
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { searchParams } = new URL(request.url)
  const environment = searchParams.get('environment') || 'Prod'

  // The real endpoint is a network hop; keep a small delay so the loading state
  // is exercised in local development rather than flashing past.
  await new Promise((resolve) => setTimeout(resolve, 450))

  const lead = leads.find((row) => row.submissionId.toLowerCase() === id.toLowerCase())
  if (!lead) {
    return NextResponse.json({ error: 'Submission not found', submissionId: id }, { status: 404 })
  }

  const seed = hash(lead.submissionId)
  const updatedAt = new Date(lead.updatedAt)
  const createdAt = new Date(updatedAt.getTime() - (seed % 72) * 3_600_000)

  return NextResponse.json({
    ...lead,
    environment,
    detail: {
      source: SOURCES[seed % SOURCES.length],
      formName: `${lead.dynamic.campaign ?? 'General'} enquiry`,
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
  })
}
