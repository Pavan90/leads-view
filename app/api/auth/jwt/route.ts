import { NextResponse } from 'next/server'

/**
 * POST /api/auth/jwt — mints the token the browser sends on later calls.
 *
 * ── Going live ────────────────────────────────────────────────────────
 * Set these in `.env.local` and this route performs a real client-
 * credentials exchange; with nothing set it returns a mock token, so no
 * code change is needed to switch:
 *
 *   LEADS_AUTH_URL=https://auth.example.com/oauth2/token
 *   LEADS_CLIENT_ID=...
 *   LEADS_CLIENT_SECRET=...
 *   LEADS_AUTH_SCOPE=leads.read          # optional
 *
 * Per-environment overrides work too, e.g. LEADS_CLIENT_ID_UAT.
 *
 * The secret is read server-side and never reaches the browser — keep it
 * out of any NEXT_PUBLIC_* variable. If your provider uses a different
 * grant, replace the body built in `tokenRequest`; the rest of the app
 * only cares that an `accessToken` comes back.
 * ─────────────────────────────────────────────────────────────────────
 */

const forEnv = (name: string, environment: string) =>
  process.env[`${name}_${environment.toUpperCase()}`] || process.env[name] || ''

function tokenRequest(environment: string) {
  const url = forEnv('LEADS_AUTH_URL', environment)
  const clientId = forEnv('LEADS_CLIENT_ID', environment)
  const clientSecret = forEnv('LEADS_CLIENT_SECRET', environment)
  const scope = forEnv('LEADS_AUTH_SCOPE', environment)
  if (!url || !clientId || !clientSecret) return null

  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret })
  if (scope) body.set('scope', scope)
  return { url, body }
}

export async function POST(request: Request) {
  const { environment = 'Prod' } = await request.json().catch(() => ({}))
  const config = tokenRequest(String(environment))

  if (config) {
    const response = await fetch(config.url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: config.body,
      cache: 'no-store',
    })
    if (!response.ok) {
      return NextResponse.json({ error: 'Token request failed', status: response.status }, { status: response.status })
    }
    const token = await response.json()
    return NextResponse.json({
      // Providers disagree on casing; accept the usual spellings.
      accessToken: token.accessToken ?? token.access_token ?? token.token ?? '',
      environment,
      expiresIn: token.expiresIn ?? token.expires_in ?? 3600,
    })
  }

  // ── Mock path: served only while no LEADS_AUTH_URL is configured. ──
  return NextResponse.json({
    accessToken: `mock-jwt-${String(environment).toLowerCase()}-token`,
    environment,
    expiresIn: 3600,
  })
}
