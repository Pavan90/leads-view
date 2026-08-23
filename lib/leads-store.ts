import { create } from 'zustand'

export type Environment = 'Dev' | 'UAT' | 'Prod'
export type LeadStatus = 'New' | 'Contacted' | 'Qualified' | 'Disqualified'
export type Lead = { firstName: string; lastName: string; email: string; phoneNumber: string; submissionId: string; updatedAt: string; status: LeadStatus; dynamic: Record<string, string> }

type LeadsState = { leads: Lead[]; loading: boolean; continuationToken: string | null; environment: Environment; setEnvironment: (environment: Environment) => void; fetchLeads: (environment: Environment, pageSize?: number, continuationToken?: string | null) => Promise<void> }

export const useLeadsStore = create<LeadsState>((set) => ({
  leads: [], loading: false, continuationToken: null, environment: 'Prod',
  setEnvironment: (environment) => set({ environment }),
  fetchLeads: async (environment, pageSize = 25, continuationToken = null) => {
    set({ loading: true, environment })
    try {
      const tokenResponse = await fetch('/api/auth/jwt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ environment }) })
      if (!tokenResponse.ok) throw new Error('JWT request failed')
      const { accessToken } = await tokenResponse.json()
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
}))
