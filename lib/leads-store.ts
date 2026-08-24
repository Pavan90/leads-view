import { create } from 'zustand'

export type Environment = 'Dev' | 'UAT' | 'Prod'
/** The canonical pipeline stages, but any string an API returns is accepted —
 *  the union only exists to keep autocomplete useful. */
export type LeadStatus = 'New' | 'Contacted' | 'Qualified' | 'Disqualified' | (string & {})
export type Lead = { firstName: string; lastName: string; email: string; phoneNumber: string; submissionId: string; updatedAt: string; status: LeadStatus; dynamic: Record<string, string> }

/** What GET /submissionbyid adds on top of the record the list endpoint returns. */
export type SubmissionDetail = Lead & {
  environment?: string
  detail?: Record<string, string | number | boolean>
  history?: { at: string; event: string }[]
}

type LeadsState = {
  leads: Lead[]
  loading: boolean
  continuationToken: string | null
  environment: Environment
  submission: SubmissionDetail | null
  submissionLoading: boolean
  submissionError: string | null
  setEnvironment: (environment: Environment) => void
  fetchLeads: (environment: Environment, pageSize?: number, continuationToken?: string | null) => Promise<void>
  fetchSubmissionById: (environment: Environment, submissionId: string) => Promise<SubmissionDetail | null>
  clearSubmission: () => void
}

// Lookups fire on every debounced keystroke, so responses can land out of
// order. Only the newest request is allowed to write to the store.
let latestSubmissionRequest = 0

async function getAccessToken(environment: Environment) {
  const tokenResponse = await fetch('/api/auth/jwt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ environment }) })
  if (!tokenResponse.ok) throw new Error('JWT request failed')
  const { accessToken } = await tokenResponse.json()
  return accessToken as string
}

export const useLeadsStore = create<LeadsState>((set, get) => ({
  leads: [], loading: false, continuationToken: null, environment: 'Prod',
  submission: null, submissionLoading: false, submissionError: null,
  setEnvironment: (environment) => set({ environment }),
  fetchLeads: async (environment, pageSize = 25, continuationToken = null) => {
    set({ loading: true, environment })
    try {
      const accessToken = await getAccessToken(environment)
      const params = new URLSearchParams({ environment, pageSize: String(pageSize), startTime: '0', endTime: String(Date.now()) })
      if (continuationToken) params.set('continuationToken', continuationToken)
      const response = await fetch(`/api/leads?${params}`, { headers: { Authorization: `Bearer ${accessToken}` } })
      if (!response.ok) throw new Error('Leads request failed')
      const result = await response.json()
      set({ leads: result.items ?? [], continuationToken: result.continuationToken ?? null, loading: false })
    } catch (error) {
      console.error('[v0] Failed to load leads:', error)
      set({ leads: [], continuationToken: null, loading: false })
    }
  },
  fetchSubmissionById: async (environment, submissionId) => {
    const id = submissionId.trim()
    if (!id) return null
    const requestId = ++latestSubmissionRequest
    const isStale = () => requestId !== latestSubmissionRequest
    set({ submissionLoading: true, submissionError: null })
    try {
      const accessToken = await getAccessToken(environment)
      const params = new URLSearchParams({ environment })
      const response = await fetch(`/api/submissions/${encodeURIComponent(id)}?${params}`, { headers: { Authorization: `Bearer ${accessToken}` } })
      if (response.status === 404) {
        if (!isStale()) set({ submission: null, submissionLoading: false, submissionError: `No submission found for ${id}` })
        return null
      }
      if (!response.ok) throw new Error('Submission request failed')
      const submission: SubmissionDetail = await response.json()
      if (!isStale()) set({ submission, submissionLoading: false, submissionError: null })
      return submission
    } catch (error) {
      console.error('[v0] Failed to load submission:', error)
      if (!isStale()) set({ submission: null, submissionLoading: false, submissionError: 'Could not reach the submission API' })
      return null
    }
  },
  clearSubmission: () => {
    latestSubmissionRequest++
    if (get().submission || get().submissionError || get().submissionLoading) {
      set({ submission: null, submissionError: null, submissionLoading: false })
    }
  },
}))
