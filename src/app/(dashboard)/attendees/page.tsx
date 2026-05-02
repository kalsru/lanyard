'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Navbar } from '@/components/dashboard/navbar'
import { AttendeeCard, type Attendee } from '@/components/dashboard/attendee-card'
import { CompanyDrawer } from '@/components/dashboard/company-drawer'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'

type Mode = 'screenshot' | 'url'

type ExtractState =
  | { status: 'idle' }
  | { status: 'loading'; label: string }
  | { status: 'error'; message: string }

type Conference = { id: string; name: string; url: string | null }

type PendingExtraction = {
  attendees: Attendee[]
  conferenceName: string
  source: string
}

export default function AttendeesPage() {
  const [mode, setMode] = useState<Mode>('url')
  const [extractState, setExtractState] = useState<ExtractState>({ status: 'idle' })
  const [savedAttendees, setSavedAttendees] = useState<Attendee[]>([])
  const [conferences, setConferences] = useState<Conference[]>([])
  const [conferenceFilter, setConferenceFilter] = useState<string>('all')
  const [loadingInitial, setLoadingInitial] = useState(true)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [url, setUrl] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [conferenceName, setConferenceName] = useState('')
  const [pending, setPending] = useState<PendingExtraction | null>(null)
  const [drawerCompany, setDrawerCompany] = useState<{ name: string; url: string | null } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const loadSaved = useCallback(async () => {
    const supabase = createClient()

    const [attendeesRes, conferencesRes] = await Promise.all([
      supabase.from('attendees').select('*').order('created_at', { ascending: false }).limit(5000),
      supabase.from('conferences').select('id, name, url').order('created_at', { ascending: false }),
    ])

    if (attendeesRes.data) {
      setSavedAttendees(attendeesRes.data.map((r) => ({
        id: r.id,
        name: r.name,
        title: r.title,
        company: r.company,
        location: r.location,
        tags: r.tags ?? [],
        avatar_url: r.avatar_url,
        linkedin_url: r.linkedin_url,
        company_url: r.company_url,
        conference_id: r.conference_id ?? null,
      })))
    }
    if (conferencesRes.data) setConferences(conferencesRes.data)
    setLoadingInitial(false)
  }, [])

  useEffect(() => { loadSaved() }, [loadSaved])

  async function saveAttendees(attendees: Attendee[], source: string, confName: string) {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setExtractState({ status: 'error', message: 'Not logged in. Please refresh and sign in again.' }); return }

    // Find or create conference
    const trimmedName = confName.trim() || 'Untitled Conference'
    let conferenceId: string | null = null

    const existing = conferences.find((c) => c.name.toLowerCase() === trimmedName.toLowerCase())
    if (existing) {
      conferenceId = existing.id
    } else {
      const { data: newConf } = await supabase
        .from('conferences')
        .insert({ user_id: user.id, name: trimmedName, url: source.startsWith('http') ? source : null })
        .select('id')
        .single()
      conferenceId = newConf?.id ?? null
    }

    const rows = attendees.map((a) => ({
      user_id: user.id,
      conference_id: conferenceId,
      name: a.name,
      title: a.title ?? null,
      company: a.company ?? null,
      location: a.location ?? null,
      tags: a.tags ?? [],
      avatar_url: a.avatar_url ?? null,
      source,
    }))

    const { data: inserted, error: insertError } = await supabase.from('attendees').insert(rows).select('id, name, title, company, location')
    if (insertError) {
      setExtractState({ status: 'error', message: `Save failed: ${insertError.message}` })
      return
    }
    await loadSaved()

    if (!inserted?.length) return

    setExtractState({ status: 'loading', label: `Finding LinkedIn & company profiles... (${inserted.length} attendees)` })

    const [linkedinRes, companyRes] = await Promise.all([
      fetch('/api/find-linkedin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attendees: inserted }),
      }).then((r) => r.json() as Promise<{ results: { id: string; linkedin_url: string | null; avatar_url: string | null }[] }>),
      fetch('/api/find-company-url', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attendees: inserted }),
      }).then((r) => r.json() as Promise<{ results: { id: string; company_url: string | null }[] }>),
    ])

    for (const { id, linkedin_url, avatar_url } of linkedinRes.results.filter((r) => r.linkedin_url)) {
      await supabase.from('attendees').update({ linkedin_url, ...(avatar_url && { avatar_url }) }).eq('id', id)
    }
    for (const { id, company_url } of companyRes.results.filter((r) => r.company_url)) {
      await supabase.from('attendees').update({ company_url }).eq('id', id)
    }

    await loadSaved()
  }

  function handleFiles(files: FileList | File[] | null) {
    if (!files || files.length === 0) return
    const fileArray = Array.from(files)
    setSelectedFiles(fileArray)
    setPreviews(fileArray.map((f) => URL.createObjectURL(f)))
    setExtractState({ status: 'idle' })
    setPending(null)
  }

  async function handleExtractFromScreenshots() {
    if (!selectedFiles.length) return
    const allAttendees: Attendee[] = []
    const batchSize = 3

    for (let i = 0; i < selectedFiles.length; i += batchSize) {
      const batch = selectedFiles.slice(i, i + batchSize)
      setExtractState({ status: 'loading', label: `Processing ${Math.min(i + batchSize, selectedFiles.length)} of ${selectedFiles.length} screenshots...` })
      const formData = new FormData()
      batch.forEach((f) => formData.append('images', f))
      try {
        const res = await fetch('/api/extract-from-image', { method: 'POST', body: formData })
        const data = await res.json()
        if (data.attendees?.length) allAttendees.push(...data.attendees)
      } catch (e) { console.error('[page] Fetch error:', e) }
    }

    if (allAttendees.length === 0) {
      setExtractState({ status: 'error', message: 'Could not extract any attendees. Try a clearer screenshot.' })
      return
    }

    setPending({ attendees: allAttendees, conferenceName: conferenceName || 'Untitled Conference', source: 'screenshot' })
    setExtractState({ status: 'idle' })
  }

  async function handleExtractFromUrl() {
    if (!url.trim()) return
    setExtractState({ status: 'loading', label: 'Loading page and extracting attendees...' })
    try {
      const res = await fetch('/api/scrape-attendees', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      })
      const data = await res.json()
      if (data.attendees?.length) {
        const detectedName = data.conference_name || new URL(url.trim()).hostname.replace(/^www\./, '')
        setConferenceName(detectedName)
        setPending({ attendees: data.attendees, conferenceName: detectedName, source: url.trim() })
        setExtractState({ status: 'idle' })
      } else {
        setExtractState({ status: 'error', message: data.error ?? 'No attendees found on this page.' })
      }
    } catch {
      setExtractState({ status: 'error', message: 'Failed to reach the page. Check the URL and try again.' })
    }
  }

  async function handleConfirmSave() {
    if (!pending) return
    setExtractState({ status: 'loading', label: 'Saving...' })
    await saveAttendees(pending.attendees, pending.source, conferenceName || pending.conferenceName)
    setPending(null)
    setExtractState({ status: 'idle' })
    setSelectedFiles([])
    setPreviews([])
    setUrl('')
    setConferenceName('')
    if (inputRef.current) inputRef.current.value = ''
  }

  async function handleClearAll() {
    const supabase = createClient()
    await supabase.from('attendees').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    await supabase.from('conferences').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    setSavedAttendees([])
    setConferences([])
    setSelectedFiles([])
    setPreviews([])
    setUrl('')
    setConferenceName('')
    setSearchQuery('')
    setPending(null)
    setConferenceFilter('all')
    setExtractState({ status: 'idle' })
    if (inputRef.current) inputRef.current.value = ''
  }

  function switchMode(m: Mode) {
    setMode(m)
    setExtractState({ status: 'idle' })
    setSelectedFiles([])
    setPreviews([])
    setUrl('')
    setPending(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const filteredAttendees = savedAttendees.filter((a) => {
    if (conferenceFilter !== 'all' && (a as Attendee & { conference_id?: string }).conference_id !== conferenceFilter) return false
    const q = searchQuery.toLowerCase()
    return (
      !q ||
      a.name.toLowerCase().includes(q) ||
      a.company?.toLowerCase().includes(q) ||
      a.title?.toLowerCase().includes(q) ||
      a.location?.toLowerCase().includes(q)
    )
  })

  const isLoading = extractState.status === 'loading'
  const withLinkedIn = savedAttendees.filter((a) => a.linkedin_url).length
  const withCompany = savedAttendees.filter((a) => a.company_url).length

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar profile={null} />

      {/* Hero */}
      <div className="bg-gradient-to-br from-violet-700 via-fuchsia-600 to-orange-500 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <h1 className="text-4xl font-black tracking-tight mb-1">Attendee Intelligence</h1>
          <p className="text-fuchsia-200 text-sm mb-8">Extract, enrich and explore event attendee profiles instantly.</p>

          {/* Stat pills */}
          {savedAttendees.length > 0 && (
            <div className="flex flex-wrap gap-3 mb-8">
              {[
                { label: 'Total', value: savedAttendees.length, color: 'bg-white/20' },
                { label: 'Conferences', value: conferences.length, color: 'bg-indigo-500/40' },
                { label: 'LinkedIn', value: withLinkedIn, color: 'bg-blue-500/40' },
                { label: 'Company', value: withCompany, color: 'bg-emerald-500/40' },
              ].map(({ label, value, color }) => value > 0 && (
                <div key={label} className={`${color} backdrop-blur-sm rounded-2xl px-4 py-2 text-center min-w-[72px]`}>
                  <p className="text-2xl font-black leading-none">{value}</p>
                  <p className="text-xs text-white/80 mt-0.5">{label}</p>
                </div>
              ))}
            </div>
          )}

          {/* Input section */}
          <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-5 max-w-2xl">
            <div className="flex gap-1 mb-4 bg-white/10 rounded-xl p-1 w-fit">
              {(['url', 'screenshot'] as const).map((m) => (
                <button key={m} onClick={() => switchMode(m)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${mode === m ? 'bg-white text-indigo-700 shadow' : 'text-white/80 hover:text-white'}`}>
                  {m === 'url' ? '🔗 URL' : '📸 Screenshots'}
                </button>
              ))}
            </div>

            {/* Conference name field (always visible) */}
            <div className="mb-3">
              <input
                type="text"
                placeholder="Conference name (auto-detected from URL)"
                value={conferenceName}
                onChange={(e) => setConferenceName(e.target.value)}
                className="w-full px-4 py-2 text-sm rounded-xl bg-white/20 text-white placeholder-white/50 border border-white/20 focus:outline-none focus:ring-2 focus:ring-white/40"
              />
            </div>

            {mode === 'url' && (
              <div className="flex gap-2">
                <input type="url" placeholder="https://example.com/speakers" value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleExtractFromUrl()}
                  disabled={isLoading}
                  className="flex-1 px-4 py-2.5 text-sm rounded-xl bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-white/50 disabled:opacity-50" />
                <Button onClick={handleExtractFromUrl} disabled={isLoading || !url.trim()}
                  className="bg-white text-indigo-700 hover:bg-indigo-50 font-bold rounded-xl px-5">
                  Extract
                </Button>
              </div>
            )}

            {mode === 'screenshot' && (
              <>
                <div className="border-2 border-dashed border-white/40 rounded-xl py-8 text-center cursor-pointer hover:border-white/70 hover:bg-white/5 transition-all"
                  onClick={() => inputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files) }}>
                  <p className="text-3xl mb-2">📸</p>
                  <p className="font-semibold text-white text-sm">Drop screenshots here or click to upload</p>
                  <p className="text-white/60 text-xs mt-1">PNG, JPG — multiple files supported</p>
                  <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
                </div>
                {selectedFiles.length > 0 && (
                  <div className="mt-4">
                    <div className="flex flex-wrap gap-2 mb-3">
                      {previews.map((src, i) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={i} src={src} alt={`Preview ${i + 1}`} className="h-16 w-24 object-cover rounded-lg border-2 border-white/30" />
                      ))}
                    </div>
                    <Button onClick={handleExtractFromScreenshots} disabled={isLoading}
                      className="bg-white text-indigo-700 hover:bg-indigo-50 font-bold rounded-xl">
                      Extract &amp; Save {selectedFiles.length} screenshot{selectedFiles.length > 1 ? 's' : ''}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Loading banner */}
        {isLoading && (
          <div className="flex items-center gap-3 bg-violet-50 border border-violet-200 rounded-2xl px-5 py-4 mb-6">
            <div className="h-5 w-5 border-2 border-violet-600 border-t-transparent rounded-full animate-spin shrink-0" />
            <p className="text-sm font-semibold text-violet-700">{(extractState as Extract<ExtractState, { status: 'loading' }>).label}</p>
          </div>
        )}

        {/* Error banner */}
        {extractState.status === 'error' && (
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-2xl px-5 py-4 mb-6">
            <span className="text-red-500 text-lg shrink-0">⚠️</span>
            <div>
              <p className="text-sm font-semibold text-red-700">Extraction failed</p>
              <p className="text-sm text-red-600 mt-0.5">{extractState.message}</p>
            </div>
          </div>
        )}

        {/* Pending confirmation */}
        {pending && !isLoading && (
          <div className="bg-white border border-violet-200 rounded-2xl px-5 py-4 mb-6 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1">
                <p className="text-sm font-bold text-slate-700">
                  Found <span className="text-violet-600">{pending.attendees.length} attendees</span>. Confirm conference name before saving:
                </p>
                <input
                  type="text"
                  value={conferenceName || pending.conferenceName}
                  onChange={(e) => setConferenceName(e.target.value)}
                  className="mt-2 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-400 font-medium"
                  placeholder="Conference name..."
                />
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => { setPending(null); setExtractState({ status: 'idle' }) }}
                  className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700 font-medium rounded-lg hover:bg-slate-50 transition-colors">
                  Cancel
                </button>
                <Button onClick={handleConfirmSave}
                  className="bg-violet-600 hover:bg-violet-700 text-white font-bold rounded-xl px-5">
                  Save {pending.attendees.length} attendees
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Attendee grid */}
        {loadingInitial ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-400">
            <div className="h-10 w-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-sm font-medium">Loading attendees...</p>
          </div>
        ) : savedAttendees.length > 0 ? (
          <>
            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
              <div className="flex flex-col sm:flex-row gap-2 flex-1 max-w-2xl">
                {/* Conference filter */}
                {conferences.length > 0 && (
                  <select
                    value={conferenceFilter}
                    onChange={(e) => setConferenceFilter(e.target.value)}
                    className="px-3 py-2.5 text-sm bg-white border border-slate-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 font-medium text-slate-700 min-w-[180px]"
                  >
                    <option value="all">All conferences</option>
                    {conferences.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                )}
                {/* Search */}
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
                  <input type="text" placeholder="Search name, company, title, location..."
                    value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-4 py-2.5 text-sm bg-white border border-slate-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <p className="text-sm text-slate-500 font-medium">
                  {searchQuery || conferenceFilter !== 'all' ? `${filteredAttendees.length} of ` : ''}{savedAttendees.length} attendees
                </p>
                <button onClick={handleClearAll}
                  className="text-xs text-red-500 hover:text-red-700 font-semibold px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors">
                  Clear all
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredAttendees.map((attendee) => (
                <AttendeeCard key={attendee.id} attendee={attendee}
                  onCompanyClick={(name, url) => setDrawerCompany({ name, url })} />
              ))}
            </div>
          </>
        ) : (
          !isLoading && !pending && (
            <div className="flex flex-col items-center justify-center py-24 text-slate-400">
              <div className="text-6xl mb-4">🎟️</div>
              <p className="text-lg font-bold text-slate-600 mb-1">No attendees yet</p>
              <p className="text-sm">Paste a URL or upload screenshots above to get started.</p>
            </div>
          )
        )}
      </main>

      {drawerCompany && (
        <CompanyDrawer companyName={drawerCompany.name} companyUrl={drawerCompany.url}
          onClose={() => setDrawerCompany(null)} />
      )}
    </div>
  )
}
