import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const { environment = 'Prod' } = await request.json().catch(() => ({}))
  return NextResponse.json({ accessToken: `mock-jwt-${String(environment).toLowerCase()}-token`, environment, expiresIn: 3600 })
}
