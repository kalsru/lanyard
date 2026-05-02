'use client'

import { useEffect, useState } from 'react'
import { X, Globe, MapPin, Users, Calendar, DollarSign, Building2, RefreshCw } from 'lucide-react'
import type { CompanyProfile } from '@/app/api/company-profile/route'

type Props = {
  companyName: string
  companyUrl: string | null
  onClose: () => void
}

const HEADER_GRADIENTS = [
  'from-violet-600 to-indigo-700',
  'from-orange-500 to-rose-600',
  'from-emerald-500 to-cyan-600',
  'from-fuchsia-600 to-pink-600',
  'from-amber-500 to-orange-600',
  'from-sky-500 to-blue-700',
]

function pickGradient(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return HEADER_GRADIENTS[Math.abs(h) % HEADER_GRADIENTS.length]
}

function MetaRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 shrink-0 text-slate-400">{icon}</div>
      <div>
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{label}</p>
        <p className="text-sm text-slate-700 font-medium">{value}</p>
      </div>
    </div>
  )
}

export function CompanyDrawer({ companyName, companyUrl, onClose }: Props) {
  const [profile, setProfile] = useState<CompanyProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  function fetchProfile(refresh = false) {
    setLoading(true)
    setError(null)

    const params = new URLSearchParams()
    if (companyUrl) params.set('url', companyUrl)
    else params.set('name', companyName)
    if (refresh) params.set('refresh', 'true')

    fetch(`/api/company-profile?${params}`)
      .then((r) => r.json())
      .then((data: CompanyProfile & { error?: string }) => {
        if (data.error && !data.description) setError(data.error)
        else setProfile(data)
      })
      .catch(() => setError('Failed to load profile.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    setProfile(null)
    fetchProfile()
  }, [companyUrl, companyName]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const displayName = profile?.name ?? companyName
  const initials = displayName.split(/\s+/).map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)
  const gradient = pickGradient(companyName)
  const websiteUrl = profile?.website_url ?? companyUrl ?? null

  return (
    <>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 animate-in fade-in duration-200" onClick={onClose} />

      <div className="fixed right-0 top-0 h-full w-full max-w-sm bg-white z-50 shadow-2xl flex flex-col overflow-y-auto animate-in slide-in-from-right duration-300">

        {/* Header */}
        <div className={`relative bg-gradient-to-br ${gradient} px-6 pt-6 pb-20`}>
          <div className="absolute top-4 right-4 flex items-center gap-1">
            {!loading && (
              <button
                onClick={() => fetchProfile(true)}
                className="p-1.5 rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors"
                title="Refresh"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest mb-1">Company Profile</p>
          <h2 className="text-xl font-black text-white leading-tight pr-16">{displayName}</h2>
        </div>

        {/* Logo */}
        <div className="relative flex justify-center -mt-10 mb-4">
          <div className="h-20 w-20 rounded-2xl bg-white shadow-xl ring-4 ring-white flex items-center justify-center overflow-hidden relative">
            {loading ? (
              <div className="h-8 w-8 rounded-full bg-slate-100 animate-pulse" />
            ) : profile?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.logo_url}
                alt={displayName}
                className="h-full w-full object-contain p-2"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            ) : (
              <>
                <Building2 className="h-8 w-8 text-slate-200" />
                <span className="absolute text-lg font-black text-slate-600">{initials}</span>
              </>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="px-6 pb-8 flex flex-col gap-5">

          {/* Loading skeleton */}
          {loading && (
            <div className="space-y-4 animate-pulse">
              <div className="flex gap-2">
                <div className="h-6 bg-slate-100 rounded-full w-24" />
                <div className="h-6 bg-slate-100 rounded-full w-16" />
              </div>
              <div className="space-y-2">
                <div className="h-4 bg-slate-100 rounded w-full" />
                <div className="h-4 bg-slate-100 rounded w-5/6" />
                <div className="h-4 bg-slate-100 rounded w-4/5" />
              </div>
              <div className="space-y-3 pt-2">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex gap-3">
                    <div className="h-4 w-4 bg-slate-100 rounded mt-1" />
                    <div className="space-y-1 flex-1">
                      <div className="h-2.5 bg-slate-100 rounded w-16" />
                      <div className="h-4 bg-slate-100 rounded w-32" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && !loading && (
            <div className="text-center py-6">
              <p className="text-sm text-slate-400">{error}</p>
              <button onClick={() => fetchProfile(true)} className="mt-3 text-xs text-violet-600 hover:underline font-semibold">
                Try again
              </button>
            </div>
          )}

          {profile && !loading && (
            <>
              {/* Badges */}
              <div className="flex flex-wrap gap-2">
                {profile.industry && (
                  <span className="text-xs font-bold px-3 py-1 rounded-full bg-violet-100 text-violet-700">
                    {profile.industry}
                  </span>
                )}
                {profile.sic_code && (
                  <span className="text-xs font-bold px-3 py-1 rounded-full bg-slate-100 text-slate-600 font-mono">
                    SIC {profile.sic_code}
                  </span>
                )}
              </div>

              {/* SIC description */}
              {profile.sic_description && (
                <p className="text-xs text-slate-400 -mt-3 pl-1">{profile.sic_description}</p>
              )}

              {/* Description */}
              {profile.description && (
                <p className="text-sm text-slate-600 leading-relaxed">{profile.description}</p>
              )}

              {/* Metadata grid */}
              <div className="flex flex-col gap-3 border-t border-slate-100 pt-4">
                {profile.revenue && (
                  <MetaRow icon={<DollarSign className="h-4 w-4" />} label="Revenue" value={profile.revenue} />
                )}
                {profile.employee_count && (
                  <MetaRow icon={<Users className="h-4 w-4" />} label="Employees" value={profile.employee_count} />
                )}
                {profile.hq && (
                  <MetaRow icon={<MapPin className="h-4 w-4" />} label="Headquarters" value={profile.hq} />
                )}
                {profile.founded_year && (
                  <MetaRow icon={<Calendar className="h-4 w-4" />} label="Founded" value={profile.founded_year} />
                )}
                {websiteUrl && (
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 shrink-0 text-slate-400"><Globe className="h-4 w-4" /></div>
                    <div>
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Website</p>
                      <a href={websiteUrl} target="_blank" rel="noopener noreferrer"
                        className="text-sm text-violet-600 hover:underline font-medium truncate block max-w-[220px]">
                        {websiteUrl.replace(/^https?:\/\//, '')}
                      </a>
                    </div>
                  </div>
                )}
              </div>

              {/* CTA */}
              {websiteUrl && (
                <a
                  href={websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-700 text-white text-sm font-bold transition-colors"
                >
                  <Globe className="h-4 w-4" />
                  Visit Website
                </a>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}
