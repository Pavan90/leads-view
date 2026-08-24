'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useReactTable, getCoreRowModel, flexRender, type ColumnDef } from '@tanstack/react-table'
import { useLeadsStore, type Lead, type Environment } from '@/lib/leads-store'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import {
  Calendar, Check, ChevronDown, ChevronLeft, ChevronRight, Download, Layers, Loader2,
  Moon, RefreshCw, Search, Sun, X, Zap,
} from 'lucide-react'

type TimeRange = 'Today' | 'Yesterday' | 'Last 7 days' | 'Last 14 days' | 'Last 30 days'
type Breakdown = 'campaign' | 'region' | 'interest'

const environments: Environment[] = ['Dev', 'UAT', 'Prod']
const timeRanges: TimeRange[] = ['Today', 'Yesterday', 'Last 7 days', 'Last 14 days', 'Last 30 days']
const statuses = ['All statuses', 'New', 'Contacted', 'Qualified', 'Disqualified'] as const
const breakdowns: Breakdown[] = ['campaign', 'region', 'interest']
const statusOrder = ['New', 'Contacted', 'Qualified', 'Disqualified'] as const

// The mock API serves a fixed August 2026 window, so "now" is pinned rather than
// read from the clock — a live Date() would also desync SSR and hydration.
const NOW = new Date('2026-08-23T16:42:00Z')
const DAY = 86_400_000

const chartConfig = { leads: { label: 'Leads', color: 'var(--data)' } } satisfies ChartConfig

function getRangeDates(range: TimeRange) {
  const end = new Date(NOW)
  const start = new Date(NOW)
  start.setUTCHours(0, 0, 0, 0)
  if (range === 'Yesterday') {
    start.setUTCDate(start.getUTCDate() - 1)
    end.setTime(start.getTime() + DAY - 1)
  } else if (range !== 'Today') {
    start.setUTCDate(start.getUTCDate() - (Number(range.split(' ')[1]) - 1))
  }
  return { start, end }
}

const dayKey = (value: string | Date) =>
  (typeof value === 'string' ? new Date(value) : value).toISOString().slice(0, 10)

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
  }).format(new Date(value))
}

function formatDayLabel(key: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${key}T00:00:00Z`))
}

const statusClass = (status: Lead['status']) => `status-${status.toLowerCase()}`
const statusVar = (status: Lead['status']) => `var(--st-${status.toLowerCase()})`

/** Counts values of one dimension, largest first. */
function tally(leads: Lead[], pick: (lead: Lead) => string | undefined) {
  const counts = new Map<string, number>()
  for (const lead of leads) {
    const key = pick(lead)
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
}

function Dropdown({ icon, value, options, onChange, ariaLabel }: {
  icon?: React.ReactNode
  value: string
  options: readonly string[]
  onChange: (next: string) => void
  ariaLabel: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="dd" ref={ref}>
      <button className="chip" aria-label={ariaLabel} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {icon}{value}<ChevronDown />
      </button>
      {open && (
        <div className="dd-menu" role="listbox" aria-label={ariaLabel}>
          {options.map((option) => (
            <button
              key={option}
              role="option"
              aria-selected={option === value}
              className={option === value ? 'selected' : ''}
              onClick={() => { onChange(option); setOpen(false) }}
            >
              {option}{option === value && <Check />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function StatTile({ label, value, sub, dot }: { label: string; value: string | number; sub?: string; dot?: string }) {
  return (
    <div className="kpi">
      <div className="kpi-label">
        {dot && <span className="dot" style={{ background: dot }} />}
        {label}
      </div>
      <div className="kpi-value num">{value}</div>
      {sub && <div className="kpi-sub num">{sub}</div>}
    </div>
  )
}

/** Magnitude comparison within one dimension — one hue, bar anchored to the left baseline. */
function BarList({ rows, colorFor, emptyLabel }: {
  rows: { label: string; value: number }[]
  colorFor?: (label: string) => string
  emptyLabel: string
}) {
  const max = rows.length ? Math.max(...rows.map((row) => row.value)) : 0
  const total = rows.reduce((sum, row) => sum + row.value, 0)
  if (!rows.length) return <div className="bar-empty">{emptyLabel}</div>
  return (
    <div className="bar-list">
      {rows.map((row) => (
        <div className="bar-row" key={row.label}>
          <span
            className="bar-fill"
            style={{
              width: row.value && max ? `${Math.max((row.value / max) * 100, 2)}%` : 0,
              ...(colorFor ? { background: colorFor(row.label), opacity: 0.16 } : null),
            }}
          />
          <span className="bar-label">
            <i className="dot" style={colorFor ? { background: colorFor(row.label) } : undefined} />
            {row.label}
          </span>
          <span className="bar-value num">
            {row.value}
            <small>{total ? Math.round((row.value / total) * 100) : 0}%</small>
          </span>
        </div>
      ))}
    </div>
  )
}

export default function Page() {
  const { leads: apiLeads, loading: apiLoading, fetchLeads } = useLeadsStore()
  const [environment, setEnvironment] = useState<Environment>('Prod')
  const [timeRange, setTimeRange] = useState<TimeRange>('Last 7 days')
  const [breakdown, setBreakdown] = useState<Breakdown>('campaign')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<string>('All statuses')
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [dark, setDark] = useState(false)
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)

  useEffect(() => { fetchLeads(environment, pageSize) }, [environment, pageSize, fetchLeads])

  const dateRange = useMemo(() => getRangeDates(timeRange), [timeRange])
  const busy = refreshing || apiLoading

  // Time window scopes the whole dashboard; search + status scope only the table.
  const rangeLeads = useMemo(() => apiLeads.filter((lead) => {
    const at = new Date(lead.updatedAt).getTime()
    return at >= dateRange.start.getTime() && at <= dateRange.end.getTime()
  }), [apiLeads, dateRange])

  const filteredLeads = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return rangeLeads.filter((lead) => {
      if (status !== 'All statuses' && lead.status !== status) return false
      if (!needle) return true
      const haystack = `${lead.firstName} ${lead.lastName} ${lead.email} ${lead.phoneNumber} ${lead.submissionId} ${Object.values(lead.dynamic).join(' ')}`
      return haystack.toLowerCase().includes(needle)
    })
  }, [rangeLeads, search, status])

  const stats = useMemo(() => {
    const byStatus = Object.fromEntries(statusOrder.map((key) => [key, 0])) as Record<string, number>
    for (const lead of rangeLeads) byStatus[lead.status] = (byStatus[lead.status] ?? 0) + 1
    const total = rangeLeads.length
    return { total, byStatus, qualifiedRate: total ? Math.round((byStatus.Qualified / total) * 100) : 0 }
  }, [rangeLeads])

  const trend = useMemo(() => {
    const counts = new Map<string, number>()
    for (const lead of rangeLeads) {
      const key = dayKey(lead.updatedAt)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const days: { day: string; label: string; leads: number }[] = []
    const cursor = new Date(dateRange.start)
    cursor.setUTCHours(0, 0, 0, 0)
    // Bounded: the longest offered window is 30 days.
    for (let i = 0; i < 60 && cursor.getTime() <= dateRange.end.getTime(); i++) {
      const key = dayKey(cursor)
      days.push({ day: key, label: formatDayLabel(key), leads: counts.get(key) ?? 0 })
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
    return days
  }, [rangeLeads, dateRange])

  const breakdownRows = useMemo(
    () => tally(rangeLeads, (lead) => lead.dynamic[breakdown]),
    [rangeLeads, breakdown],
  )
  // Every stage stays on screen, including the empty ones — a missing row reads
  // as "no data" rather than "zero leads".
  const statusRows = useMemo(
    () => statusOrder.map((label) => ({ label, value: stats.byStatus[label] ?? 0 })),
    [stats],
  )

  const visibleLeads = useMemo(
    () => filteredLeads.slice(page * pageSize, page * pageSize + pageSize),
    [filteredLeads, page, pageSize],
  )
  const totalPages = Math.max(1, Math.ceil(filteredLeads.length / pageSize))

  const columns = useMemo<ColumnDef<Lead>[]>(() => [
    { accessorKey: 'firstName', header: 'First name' },
    { accessorKey: 'lastName', header: 'Last name' },
    { accessorKey: 'email', header: 'Email' },
    { accessorKey: 'phoneNumber', header: 'Phone' },
    { accessorKey: 'submissionId', header: 'Submission ID' },
    { accessorKey: 'updatedAt', header: 'Updated at', cell: ({ getValue }) => formatDateTime(getValue<string>()) },
    { accessorKey: 'status', header: 'Status' },
    ...breakdowns.map((field) => ({
      id: field,
      header: field[0].toUpperCase() + field.slice(1),
      accessorFn: (row: Lead) => row.dynamic[field],
    })),
  ], [])
  const coreRowModel = useMemo(() => getCoreRowModel(), [])
  const table = useReactTable({ data: visibleLeads, columns, getCoreRowModel: coreRowModel })

  const resetPage = () => setPage(0)
  const refresh = useCallback(() => {
    setRefreshing(true)
    fetchLeads(environment, pageSize).finally(() => setRefreshing(false))
  }, [environment, pageSize, fetchLeads])

  function exportCsv() {
    const cols = ['firstName', 'lastName', 'email', 'phoneNumber', 'submissionId', 'updatedAt', 'status', ...breakdowns]
    const cell = (lead: Lead, key: string) =>
      (breakdowns as string[]).includes(key) ? lead.dynamic[key] ?? '' : String(lead[key as keyof Lead] ?? '')
    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`
    const csv = [cols.join(','), ...filteredLeads.map((lead) => cols.map((key) => escape(cell(lead, key))).join(','))].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `leads-${environment.toLowerCase()}-${dayKey(NOW)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className={dark ? 'app-shell dark' : 'app-shell'}>
      <div className="app-panel">
        <div className="panel-inner">

          <header className="topbar">
            <div className="brand"><span className="brand-mark"><Zap /></span>lead.deck</div>
            <Dropdown
              ariaLabel="Environment"
              value={environment}
              options={environments}
              onChange={(next) => { setEnvironment(next as Environment); resetPage() }}
              icon={<span className="dot" style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--st-qualified)' }} />}
            />
            <Dropdown
              ariaLabel="Time window"
              value={timeRange}
              options={timeRanges}
              onChange={(next) => { setTimeRange(next as TimeRange); resetPage() }}
              icon={<Calendar />}
            />
            <button className="chip icon-only" onClick={refresh} aria-label="Refresh leads" disabled={busy}>
              {busy ? <Loader2 className="spin" /> : <RefreshCw />}
            </button>
            <div className="topbar-spacer" />
            <button className="chip icon-only" onClick={() => setDark(!dark)} aria-label="Toggle dark mode">
              {dark ? <Sun /> : <Moon />}
            </button>
            <button className="btn-accent" onClick={exportCsv} disabled={!filteredLeads.length}>
              <Download />Export CSV
            </button>
          </header>

          <section className="kpi-row" aria-label="Lead summary">
            <StatTile label="Leads" value={stats.total} sub={timeRange.toLowerCase()} />
            {statusOrder.map((key) => (
              <StatTile key={key} label={key} value={stats.byStatus[key]} dot={statusVar(key)}
                sub={stats.total ? `${Math.round((stats.byStatus[key] / stats.total) * 100)}% of total` : '—'} />
            ))}
            <StatTile label="Qualified rate" value={`${stats.qualifiedRate}%`} sub={`${stats.byStatus.Qualified}/${stats.total} leads`} />
          </section>

          <section className="card" aria-label="Submissions over time">
            <div className="card-head">
              <div>
                <h2>Submissions</h2>
                <p>Leads received per day · {environment} · UTC</p>
              </div>
              <span className="chip" style={{ pointerEvents: 'none' }}>{trend.length} days</span>
            </div>
            <div className="card-body">
              {busy ? (
                <div className="state-block"><Loader2 className="spin" /><strong>Fetching from {environment}</strong></div>
              ) : (
                <ChartContainer config={chartConfig} className="h-[260px] w-full">
                  <BarChart accessibilityLayer data={trend} margin={{ left: 4, right: 8, top: 10, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={10} minTickGap={18}
                      tick={{ fill: 'var(--text-3)', fontSize: 11 }} />
                    <YAxis tickLine={false} axisLine={false} width={26} allowDecimals={false}
                      domain={[0, (max: number) => Math.max(1, Math.ceil(max * 1.2))]}
                      tick={{ fill: 'var(--text-3)', fontSize: 11 }} />
                    <ChartTooltip cursor={{ fill: 'var(--raised)' }} content={<ChartTooltipContent indicator="dot" />} />
                    <Bar dataKey="leads" fill="var(--data)" radius={[4, 4, 0, 0]} maxBarSize={34} />
                  </BarChart>
                </ChartContainer>
              )}
            </div>
          </section>

          <section className="split">
            <div className="card">
              <div className="card-head">
                <div><h2>Top {breakdown}s</h2><p>Share of leads in window</p></div>
                <div className="seg">
                  {breakdowns.map((field) => (
                    <button key={field} className={breakdown === field ? 'selected' : ''} onClick={() => setBreakdown(field)}>
                      {field[0].toUpperCase() + field.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="card-body">
                <BarList rows={breakdownRows} emptyLabel={`No ${breakdown} data in this window`} />
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <div><h2>Pipeline status</h2><p>Where leads sit right now</p></div>
                <Layers style={{ width: 14, color: 'var(--text-3)' }} />
              </div>
              <div className="card-body">
                <BarList rows={statusRows} colorFor={(label) => statusVar(label as Lead['status'])}
                  emptyLabel="No leads in this window" />
              </div>
            </div>
          </section>

          <section className="card" aria-label="Lead records">
            <div className="table-toolbar">
              <div>
                <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>All leads</h2>
                <p style={{ margin: '2px 0 0', color: 'var(--text-3)', fontSize: 11 }}>
                  {busy ? 'Fetching from' : 'Synced with'} {environment} API
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div className="search-box">
                  <Search />
                  <input value={search} onChange={(e) => { setSearch(e.target.value); resetPage() }}
                    placeholder="Search leads, fields, or IDs" aria-label="Search leads" />
                  {search && <button onClick={() => { setSearch(''); resetPage() }} aria-label="Clear search"><X style={{ width: 13 }} /></button>}
                </div>
                <Dropdown ariaLabel="Status filter" value={status} options={statuses}
                  onChange={(next) => { setStatus(next); resetPage() }} />
              </div>
            </div>

            <div className="table-wrap">
              {busy ? (
                <div className="state-block">
                  <Loader2 className="spin" /><strong>Fetching leads from {environment}</strong>
                  <span>Authenticating and requesting the selected UTC window…</span>
                </div>
              ) : visibleLeads.length === 0 ? (
                <div className="state-block">
                  <Search /><strong>No leads found</strong>
                  <span>Try a wider time window, or clear your search and filters.</span>
                </div>
              ) : (
                <table>
                  <thead>
                    {table.getHeaderGroups().map((headerGroup) => (
                      <tr key={headerGroup.id}>
                        {headerGroup.headers.map((header) => (
                          <th key={header.id}>{flexRender(header.column.columnDef.header, header.getContext())}</th>
                        ))}
                      </tr>
                    ))}
                  </thead>
                  <tbody>
                    {table.getRowModel().rows.map((row) => (
                      <tr key={row.id} className="lead-row" tabIndex={0}
                        onClick={() => setSelectedLead(row.original)}
                        onKeyDown={(event) => { if (event.key === 'Enter') setSelectedLead(row.original) }}>
                        {row.getVisibleCells().map((cell) => {
                          const id = cell.column.id
                          const rendered = flexRender(cell.column.columnDef.cell, cell.getContext()) ?? cell.getValue<string>()
                          return (
                            <td key={cell.id} className={id === 'firstName' || id === 'lastName' ? 'person' : ''}>
                              {id === 'status' ? (
                                <span className={`status-pill ${statusClass(cell.getValue<Lead['status']>())}`}>
                                  <i />{cell.getValue<string>()}
                                </span>
                              ) : id === 'submissionId' ? (
                                <code>{cell.getValue<string>()}</code>
                              ) : (breakdowns as string[]).includes(id) ? (
                                <span className="tag">{cell.getValue<string>()}</span>
                              ) : rendered}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="table-footer">
              <span className="num">
                Showing <strong>{filteredLeads.length ? page * pageSize + 1 : 0}–{Math.min((page + 1) * pageSize, filteredLeads.length)}</strong>
                {' '}of <strong>{filteredLeads.length}</strong> leads
              </span>
              <div className="pagination">
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  Rows
                  <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); resetPage() }}>
                    <option>25</option><option>50</option><option>100</option>
                  </select>
                </label>
                <span className="num">Page {page + 1} of {totalPages}</span>
                <button disabled={!page} onClick={() => setPage(page - 1)} aria-label="Previous page"><ChevronLeft /></button>
                <button disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)} aria-label="Next page"><ChevronRight /></button>
              </div>
            </div>
          </section>

          <div className="footnote">
            <span className="live"><i />Read-only viewer</span>
            <code>getJwt({environment}) → /getleads?startTime={dateRange.start.getTime()}&endTime={dateRange.end.getTime()}</code>
          </div>
        </div>
      </div>

      {selectedLead && (
        <>
          <button className="drawer-backdrop" aria-label="Close lead details" onClick={() => setSelectedLead(null)} />
          <aside className="lead-drawer" aria-label="Lead details">
            <div className="drawer-head">
              <div>
                <h2>{selectedLead.firstName} {selectedLead.lastName}</h2>
                <span className={`status-pill ${statusClass(selectedLead.status)}`}><i />{selectedLead.status}</span>
              </div>
              <button className="icon-button" aria-label="Close lead details" onClick={() => setSelectedLead(null)}><X /></button>
            </div>
            <div className="drawer-section">
              <span className="drawer-label">Contact</span>
              <dl>
                <div><dt>Email</dt><dd>{selectedLead.email}</dd></div>
                <div><dt>Phone</dt><dd className="num">{selectedLead.phoneNumber}</dd></div>
              </dl>
            </div>
            <div className="drawer-section">
              <span className="drawer-label">Submission</span>
              <dl>
                <div><dt>Submission ID</dt><dd><code>{selectedLead.submissionId}</code></dd></div>
                <div><dt>Updated at</dt><dd className="num">{formatDateTime(selectedLead.updatedAt)}</dd></div>
                <div><dt>Environment</dt><dd>{environment}</dd></div>
              </dl>
            </div>
            <div className="drawer-section">
              <span className="drawer-label">Additional fields</span>
              <dl>
                {Object.entries(selectedLead.dynamic).map(([key, value]) => (
                  <div key={key}><dt>{key}</dt><dd>{value}</dd></div>
                ))}
              </dl>
            </div>
          </aside>
        </>
      )}
    </div>
  )
}
