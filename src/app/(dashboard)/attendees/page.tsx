'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Navbar } from '@/components/dashboard/navbar'
import { AttendeeCard, type Attendee } from '@/components/dashboard/attendee-card'
import { CompanyDrawer } from '@/components/dashboard/company-drawer'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/client'

type Mode = 'screenshot' | 'url'

type ExtractState =
  | { status: 'idle' }
  | { status: 'loading'; label: string }
  | { status: 'error'; message: string }

export default function AttendeesPage() {
  const [mode, setMode] = useState<Mode>('screenshot')
  const [extractState, setExtractState] = useState<ExtractState>({ status: 'idle' })
  const [savedAttendees, setSavedAttendees] = useState<Attendee[]>([])
  const [loadingInitial, setLoadingInitial] = useState(true)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [url, setUrl] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [drawerCompany, setDrawerCompany] = useState<{ name: string; url: string | null } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const loadSaved = useCallback(async (autoEnrich = false) => {
    const supabase = createClient()
    const { data } = await supabase
      .from('attendees')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5000)
    if (data) {
      const mapped: Attendee[] = data.map((r) => ({
        id: r.id,
        name: r.name,
        title: r.title,
        company: r.company,
        location: r.location,
        tags: r.tags ?? [],
        avatar_url: r.avatar_url,
        linkedin_url: r.linkedin_url,
        company_url: r.company_url,
      }))
      setSavedAttendees(mapped)

      if (autoEnrich) {
        const linkedinInput = mapped.filter((a) => !a.linkedin_url)
          .map((a) => ({ id: a.id, name: a.name, title: a.title, company: a.company, location: a.location }))
        const companyInput = mapped.filter((a) => !a.company_url)
          .map((a) => ({ id: a.id, company: a.company }))

        if (linkedinInput.length || companyInput.length) {
          setExtractState({ status: 'loading', label: `Finding ${linkedinInput.length} LinkedIn & ${companyInput.length} company profiles...` })
          const [linkedinRes, companyRes] = await Promise.all([
            linkedinInput.length ? fetch('/api/find-linkedin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attendees: linkedinInput }) }).then((r) => r.json() as Promise<{ results: { id: string; linkedin_url: string | null; avatar_url: string | null }[] }>) : Promise.resolve({ results: [] }),
            companyInput.length ? fetch('/api/find-company-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attendees: companyInput }) }).then((r) => r.json() as Promise<{ results: { id: string; company_url: string | null }[] }>) : Promise.resolve({ results: [] }),
          ])
          for (const { id, linkedin_url, avatar_url } of linkedinRes.results.filter((r) => r.linkedin_url)) {
            await supabase.from('attendees').update({ linkedin_url, ...(avatar_url && { avatar_url }) }).eq('id', id)
          }
          for (const { id, company_url } of companyRes.results.filter((r) => r.company_url)) {
            await supabase.from('attendees').update({ company_url }).eq('id', id)
          }
          await loadSaved()
        }
      }
    }
    setLoadingInitial(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadSaved(false) }, [loadSaved])

  async function saveAttendees(attendees: Attendee[], source: string) {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setExtractState({ status: 'error', message: 'Not logged in. Please refresh and sign in again.' }); return }

    const rows = attendees.map((a) => ({
      user_id: user.id,
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
      console.error('[save] Insert failed:', insertError.message)
      setExtractState({ status: 'error', message: `Save failed: ${insertError.message}` })
      return
    }
    await loadSaved()

    if (!inserted?.length) return

    setExtractState({ status: 'loading', label: `Finding LinkedIn & company profiles... (${inserted.length} attendees)` })

    const [linkedinRes, companyRes] = await Promise.all([
      fetch('/api/find-linkedin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attendees: inserted }),
      }).then((r) => r.json() as Promise<{ results: { id: string; linkedin_url: string | null; avatar_url: string | null }[] }>),
      fetch('/api/find-company-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
  }

  async function handleExtractFromScreenshots() {
    if (!selectedFiles.length) return

    const allAttendees: Attendee[] = []
    const batchSize = 3

    for (let i = 0; i < selectedFiles.length; i += batchSize) {
      const batch = selectedFiles.slice(i, i + batchSize)
      const processed = Math.min(i + batchSize, selectedFiles.length)
      setExtractState({ status: 'loading', label: `Processing ${processed} of ${selectedFiles.length} screenshots...` })

      const formData = new FormData()
      batch.forEach((f) => formData.append('images', f))

      try {
        const res = await fetch('/api/extract-from-image', { method: 'POST', body: formData })
        const data = await res.json()
        if (data.attendees?.length) allAttendees.push(...data.attendees)
      } catch (e) {
        console.error('[page] Fetch error:', e)
      }
    }

    if (allAttendees.length === 0) {
      setExtractState({ status: 'error', message: 'Could not extract any attendees. Try a clearer screenshot.' })
      return
    }

    setExtractState({ status: 'loading', label: 'Saving...' })
    await saveAttendees(allAttendees, 'screenshot')
    setExtractState({ status: 'idle' })
    setSelectedFiles([])
    setPreviews([])
    if (inputRef.current) inputRef.current.value = ''
  }

  async function handleExtractFromUrl() {
    if (!url.trim()) return

    setExtractState({ status: 'loading', label: 'Loading page and extracting attendees...' })

    try {
      const res = await fetch('/api/scrape-attendees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      })
      const data = await res.json()

      if (data.attendees?.length) {
        setExtractState({ status: 'loading', label: 'Saving...' })
        await saveAttendees(data.attendees, url.trim())
        setExtractState({ status: 'idle' })
        setUrl('')
      } else {
        setExtractState({ status: 'error', message: data.error ?? 'No attendees found on this page.' })
      }
    } catch {
      setExtractState({ status: 'error', message: 'Failed to reach the page. Check the URL and try again.' })
    }
  }

  async function handleRefreshLinkedIn() {
    const supabase = createClient()
    if (!savedAttendees.length) return

    const missingLinkedIn = savedAttendees.filter((a) => !a.linkedin_url).length
    const missingCompany = savedAttendees.filter((a) => !a.company_url).length
    setExtractState({ status: 'loading', label: `Finding ${missingLinkedIn} LinkedIn & ${missingCompany} company profiles...` })

    const linkedinInput = savedAttendees
      .filter((a) => !a.linkedin_url)
      .map((a) => ({ id: a.id, name: a.name, title: a.title, company: a.company, location: a.location }))
    const companyInput = savedAttendees
      .filter((a) => !a.company_url)
      .map((a) => ({ id: a.id, company: a.company }))

    const [linkedinRes, companyRes] = await Promise.all([
      fetch('/api/find-linkedin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attendees: linkedinInput }),
      }).then((r) => r.json() as Promise<{ results: { id: string; linkedin_url: string | null; avatar_url: string | null }[] }>),
      fetch('/api/find-company-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attendees: companyInput }),
      }).then((r) => r.json() as Promise<{ results: { id: string; company_url: string | null }[] }>),
    ])

    for (const { id, linkedin_url, avatar_url } of linkedinRes.results.filter((r) => r.linkedin_url)) {
      await supabase.from('attendees').update({ linkedin_url, ...(avatar_url && { avatar_url }) }).eq('id', id)
    }
    for (const { id, company_url } of companyRes.results.filter((r) => r.company_url)) {
      await supabase.from('attendees').update({ company_url }).eq('id', id)
    }

    await loadSaved()
    setExtractState({ status: 'idle' })
  }

  async function handleClearAll() {
    const supabase = createClient()
    await supabase.from('attendees').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    setSavedAttendees([])
    setSelectedFiles([])
    setPreviews([])
    setUrl('')
    setSearchQuery('')
    setExtractState({ status: 'idle' })
    if (inputRef.current) inputRef.current.value = ''
  }

  function switchMode(m: Mode) {
    setMode(m)
    setExtractState({ status: 'idle' })
    setSelectedFiles([])
    setPreviews([])
    setUrl('')
    if (inputRef.current) inputRef.current.value = ''
  }

  const filteredAttendees = savedAttendees.filter((a) => {
    const q = searchQuery.toLowerCase()
    return (
      a.name.toLowerCase().includes(q) ||
      a.company?.toLowerCase().includes(q) ||
      a.title?.toLowerCase().includes(q) ||
      a.location?.toLowerCase().includes(q)
    )
  })

  const isLoading = extractState.status === 'loading'

  const withLinkedIn = savedAttendees.filter((a) => a.linkedin_url).length
  const withCompany  = savedAttendees.filter((a) => a.company_url).length

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar profile={null} />

      {/* Hero header */}
      <div className="bg-gradient-to-br from-violet-700 via-fuchsia-600 to-orange-500 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <h1 className="text-4xl font-black tracking-tight mb-1">Attendee Intelligence</h1>
          <p className="text-fuchsia-200 text-sm mb-8">Extract, enrich and explore event attendee profiles instantly.</p>

          {/* Stat pills */}
          {savedAttendees.length > 0 && (
            <div className="flex flex-wrap gap-3 mb-8">
              {[
                { label: 'Total', value: savedAttendees.length, color: 'bg-white/20' },
                { label: 'LinkedIn', value: withLinkedIn, color: 'bg-blue-500/40' },
                { label: 'Company', value: withCompany, color: 'bg-emerald-500/40' },
                { label: 'Speakers', value: savedAttendees.filter((a) => a.tags?.includes('Speakers')).length, color: 'bg-indigo-500/40' },
                { label: 'Sponsors', value: savedAttendees.filter((a) => a.tags?.includes('Sponsors')).length, color: 'bg-amber-500/40' },
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
            {/* Mode tabs */}
            <div className="flex gap-1 mb-4 bg-white/10 rounded-xl p-1 w-fit">
              {(['url', 'screenshot'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => switchMode(m)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                    mode === m ? 'bg-white text-indigo-700 shadow' : 'text-white/80 hover:text-white'
                  }`}
                >
                  {m === 'url' ? '🔗 URL' : '📸 Screenshots'}
                </button>
              ))}
            </div>

            {mode === 'url' && (
              <div className="flex gap-2">
                <input
                  type="url"
                  placeholder="https://example.com/speakers"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleExtractFromUrl()}
                  disabled={isLoading}
                  className="flex-1 px-4 py-2.5 text-sm rounded-xl bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-white/50 disabled:opacity-50"
                />
                <Button
                  onClick={handleExtractFromUrl}
                  disabled={isLoading || !url.trim()}
                  className="bg-white text-indigo-700 hover:bg-indigo-50 font-bold rounded-xl px-5"
                >
                  Extract
                </Button>
              </div>
            )}

            {mode === 'screenshot' && (
              <>
                <div
                  className="border-2 border-dashed border-white/40 rounded-xl py-8 text-center cursor-pointer hover:border-white/70 hover:bg-white/5 transition-all"
                  onClick={() => inputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files) }}
                >
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
                    <Button onClick={handleExtractFromScreenshots} disabled={isLoading} className="bg-white text-indigo-700 hover:bg-indigo-50 font-bold rounded-xl">
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
              <div className="relative max-w-sm w-full">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
                <input
                  type="text"
                  placeholder="Search name, company, title, location..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 text-sm bg-white border border-slate-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
              <div className="flex items-center gap-3">
                <p className="text-sm text-slate-500 font-medium">
                  {searchQuery ? `${filteredAttendees.length} of ` : ''}{savedAttendees.length} attendees
                </p>
                <button
                  onClick={handleClearAll}
                  className="text-xs text-red-500 hover:text-red-700 font-semibold px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors"
                >
                  Clear all
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredAttendees.map((attendee) => (
                <AttendeeCard
                  key={attendee.id}
                  attendee={attendee}
                  onCompanyClick={(name, url) => setDrawerCompany({ name, url })}
                />
              ))}
            </div>
          </>
        ) : (
          !isLoading && (
            <div className="flex flex-col items-center justify-center py-24 text-slate-400">
              <div className="text-6xl mb-4">🎟️</div>
              <p className="text-lg font-bold text-slate-600 mb-1">No attendees yet</p>
              <p className="text-sm">Paste a URL or upload screenshots above to get started.</p>
            </div>
          )
        )}
      </main>
      {drawerCompany && (
        <CompanyDrawer
          companyName={drawerCompany.name}
          companyUrl={drawerCompany.url}
          onClose={() => setDrawerCompany(null)}
        />
      )}
    </div>
  )
}
