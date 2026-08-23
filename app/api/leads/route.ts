import { NextResponse } from 'next/server'
import leads from '@/data/leads.json'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const page = Number(searchParams.get('continuationToken')?.replace('page-', '') || 0)
  const pageSize = Math.min(Number(searchParams.get('pageSize') || 25), 100)
  const start = page * pageSize
  const items = leads.slice(start, start + pageSize)
  return NextResponse.json({ items, continuationToken: start + pageSize < leads.length ? `page-${page + 1}` : null, count: leads.length, environment: searchParams.get('environment') || 'Prod' })
}
