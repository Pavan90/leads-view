/**
 * Adapter between the upstream lead API and the shape this app renders.
 *
 * Everything that knows about the upstream wire format lives here, so
 * swapping the mock for a real host is a change in the route files plus,
 * at most, the alias tables below.
 *
 * The normalisers are deliberately tolerant: they accept a range of common
 * field spellings and envelope shapes, so a backend that calls a field
 * `first_name` or wraps rows in `data` instead of `items` still loads.
 * If your API uses a name that is not listed, add it to the relevant array
 * rather than changing call sites.
 */

import type { Lead, SubmissionDetail } from '@/lib/leads-store'

export type RawRecord = Record<string, unknown>

/* ------------------------------------------------------------------ *
 * Environment configuration
 * ------------------------------------------------------------------ */

export type UpstreamEnv = 'Dev' | 'UAT' | 'Prod'

/**
 * Base URL per environment. Set these in `.env.local`:
 *
 *   LEADS_API_URL_DEV=https://dev.api.example.com
 *   LEADS_API_URL_UAT=https://uat.api.example.com
 *   LEADS_API_URL_PROD=https://api.example.com
 *
 * Falls back to LEADS_API_URL when one URL serves every environment.
 * Returns null when nothing is configured, which is the signal the route
 * files use to stay on mock data.
 */
export function baseUrl(environment: UpstreamEnv): string | null {
  const perEnv = {
    Dev: process.env.LEADS_API_URL_DEV,
    UAT: process.env.LEADS_API_URL_UAT,
    Prod: process.env.LEADS_API_URL_PROD,
  }[environment]
  return (perEnv || process.env.LEADS_API_URL || '').replace(/\/$/, '') || null
}

/* ------------------------------------------------------------------ *
 * Field aliases
 * ------------------------------------------------------------------ */

/** First match wins, so list the most specific spelling first. */
const FIELD_ALIASES: Record<keyof Omit<Lead, 'dynamic'>, string[]> = {
  firstName: ['firstName', 'first_name', 'firstname', 'givenName', 'given_name', 'fname'],
  lastName: ['lastName', 'last_name', 'lastname', 'surname', 'familyName', 'family_name', 'lname'],
  email: ['email', 'emailAddress', 'email_address', 'mail'],
  phoneNumber: ['phoneNumber', 'phone_number', 'phone', 'phoneNo', 'mobile', 'msisdn'],
  submissionId: ['submissionId', 'submission_id', 'submissionID', 'referenceId', 'reference_id', 'recordId', 'id', '_id'],
  updatedAt: ['updatedAt', 'updated_at', 'modifiedAt', 'modified_at', 'submittedAt', 'submitted_at', 'createdAt', 'created_at', 'timestamp', 'date'],
  status: ['status', 'leadStatus', 'lead_status', 'state', 'stage'],
}

/** Objects whose contents become the per-lead `dynamic` fields. */
const DYNAMIC_CONTAINERS = ['dynamic', 'customFields', 'custom_fields', 'fields', 'answers', 'attributes', 'formData', 'form_data']

/** Objects merged into the drawer's "Submission details" section. */
const DETAIL_CONTAINERS = ['detail', 'details', 'meta', 'metadata']

/** Arrays rendered as the drawer's activity timeline. */
const HISTORY_CONTAINERS = ['history', 'timeline', 'events', 'activity', 'auditTrail', 'audit_trail']

/** Keys in a list response that hold the rows. */
const ITEM_CONTAINERS = ['items', 'data', 'results', 'records', 'leads', 'submissions', 'content', 'value']

/** Keys that carry the "fetch the next page" cursor. */
const TOKEN_FIELDS = ['continuationToken', 'continuation_token', 'nextToken', 'next_token', 'nextCursor', 'next_cursor', 'cursor', 'nextPageToken', 'next']

/* ------------------------------------------------------------------ *
 * Value coercion
 * ------------------------------------------------------------------ */

const isRecord = (value: unknown): value is RawRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isScalar = (value: unknown): value is string | number | boolean =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'

/** Reads the first alias present on the record with a usable value. */
function pick(raw: RawRecord, aliases: string[]): unknown {
  for (const alias of aliases) {
    const value = raw[alias]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

/**
 * Accepts ISO strings, epoch seconds and epoch milliseconds, since all three
 * are common. Returns null when the value cannot be read as a date, so
 * callers can decide on a fallback rather than rendering "Invalid Date".
 */
export function toIsoString(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'number' || (typeof value === 'string' && /^\d{9,}$/.test(value.trim()))) {
    const n = Number(value)
    if (!Number.isFinite(n)) return null
    // Ten-digit values are seconds; anything longer is already milliseconds.
    const date = new Date(n < 1e11 ? n * 1000 : n)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  if (typeof value === 'string') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  return null
}

const toText = (value: unknown) => (isScalar(value) ? String(value) : '')

/** Flattens a container into string fields, skipping nested objects. */
function flattenScalars(source: unknown): Record<string, string> {
  if (!isRecord(source)) return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    if (isScalar(value)) out[key] = String(value)
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Normalisers
 * ------------------------------------------------------------------ */

/** Every key the core Lead shape consumes, used to find "leftover" fields. */
const CONSUMED_KEYS = new Set([
  ...Object.values(FIELD_ALIASES).flat(),
  ...DYNAMIC_CONTAINERS,
  ...DETAIL_CONTAINERS,
  ...HISTORY_CONTAINERS,
  'environment',
])

/**
 * Maps one upstream record onto the Lead shape.
 *
 * `dynamic` holds the per-form fields the table and breakdown cards render.
 * It is taken from a known container when the API provides one, and
 * otherwise from whatever scalar fields are left over — so an API that
 * returns custom fields at the top level still populates the breakdowns.
 */
export function normalizeLead(raw: RawRecord, index = 0): Lead {
  const updatedAt = toIsoString(pick(raw, FIELD_ALIASES.updatedAt))

  const containers = DYNAMIC_CONTAINERS.map((key) => raw[key]).filter(isRecord)
  const fromContainers = Object.assign({}, ...containers.map(flattenScalars)) as Record<string, string>

  // Only fall back to leftovers when the API gave us no container at all;
  // otherwise unrelated top-level fields would pollute the breakdowns.
  const leftovers: Record<string, string> = {}
  if (!containers.length) {
    for (const [key, value] of Object.entries(raw)) {
      if (!CONSUMED_KEYS.has(key) && isScalar(value)) leftovers[key] = String(value)
    }
  }

  return {
    firstName: toText(pick(raw, FIELD_ALIASES.firstName)),
    lastName: toText(pick(raw, FIELD_ALIASES.lastName)),
    email: toText(pick(raw, FIELD_ALIASES.email)),
    phoneNumber: toText(pick(raw, FIELD_ALIASES.phoneNumber)),
    submissionId: toText(pick(raw, FIELD_ALIASES.submissionId)) || `row-${index}`,
    // A row with no readable timestamp still has to sort and filter, so it
    // falls back to the epoch rather than dropping out of every window.
    updatedAt: updatedAt ?? new Date(0).toISOString(),
    status: toText(pick(raw, FIELD_ALIASES.status)) || 'Unknown',
    dynamic: containers.length ? fromContainers : leftovers,
  }
}

/** Pulls the rows and paging cursor out of whatever envelope the API uses. */
export function normalizeList(payload: unknown): { items: Lead[]; continuationToken: string | null; count: number | null } {
  const rows =
    Array.isArray(payload) ? payload
    : isRecord(payload) ? (ITEM_CONTAINERS.map((key) => payload[key]).find(Array.isArray) as unknown[] | undefined) ?? []
    : []

  const envelope = isRecord(payload) ? payload : {}
  const token = pick(envelope, TOKEN_FIELDS)
  const count = pick(envelope, ['count', 'total', 'totalCount', 'total_count', 'totalRecords'])

  return {
    items: rows.filter(isRecord).map(normalizeLead),
    continuationToken: isScalar(token) ? String(token) : null,
    count: typeof count === 'number' ? count : null,
  }
}

/**
 * Maps a by-id response. Anything the Lead shape does not consume becomes a
 * row in the drawer's "Submission details" list, so extra fields the API
 * starts returning show up without a code change.
 */
export function normalizeSubmission(raw: RawRecord, environment?: string): SubmissionDetail {
  const lead = normalizeLead(raw)

  const detail: Record<string, string | number | boolean> = {}
  for (const key of DETAIL_CONTAINERS) {
    if (isRecord(raw[key])) {
      for (const [k, v] of Object.entries(raw[key] as RawRecord)) if (isScalar(v)) detail[k] = v
    }
  }
  // Leftover top-level scalars are detail too, unless they already appear as
  // a dynamic field (which would render the same value twice).
  for (const [key, value] of Object.entries(raw)) {
    if (!CONSUMED_KEYS.has(key) && isScalar(value) && !(key in lead.dynamic)) detail[key] = value
  }

  const rawHistory = HISTORY_CONTAINERS.map((key) => raw[key]).find(Array.isArray) as unknown[] | undefined
  const history = (rawHistory ?? []).filter(isRecord).map((entry) => ({
    at: toIsoString(pick(entry, ['at', 'timestamp', 'date', 'createdAt', 'occurredAt', 'time'])) ?? '',
    event: toText(pick(entry, ['event', 'description', 'message', 'action', 'type', 'name'])),
  })).filter((entry) => entry.at || entry.event)

  return {
    ...lead,
    environment: environment ?? toText(raw.environment) ?? undefined,
    ...(Object.keys(detail).length ? { detail } : null),
    ...(history.length ? { history } : null),
  }
}
