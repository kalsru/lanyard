'use client'

import { useEffect, useState } from 'react'
import { X, Globe, MapPin, Users, Building2 } from 'lucide-react'

type CompanyProfile = {
  domain: string
  name: string | null
  description: string | null
  industry: string | null
  hq: string | null
  size: string | null
  logo_url: string | null
  website_url: string
}

type Props = {
  companyName: string
  companyUrl: string | null
  onClose: () => void
}

const GRADIENT_COLORS = [
  'from-violet-600 to-indigo-700',
  'from-orange-500 to-rose-600',
  'from-emerald-500 to-cyan-600',
  'from-fuchsia-600 to-pink-600',
  'from-amber-500 to-orange-600',
  'from-sky-500 to-blue-700',
]

function headerGradient(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return GRADIENT_COLORS[Math.abs(h) % GRADIENT_COLORS.length]
}

export function CompanyDrawer({ companyName, companyUrl, onClose }: Props) {
  const [profile, setProfile] = useState<CompanyProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    setProfile(null)

    const params = new URLSearchParams()
    if (companyUrl) params.set('url', companyUrl)
    else params.set('name', companyName)

    fetch(`/api/company-profile?${params}`)
      .then((r) => r.json())
      .then((data) => setProfile(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [companyUrl, companyName])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const displayName = profile?.name ?? companyName
  const initials = displayName.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 2)
  const gradient = headerGradient(companyName)
  const websiteUrl = profile?.website_url ?? companyUrl ?? null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-sm bg-white z-50 shadow-2xl flex flex-col overflow-y-auto animate-in slide-in-from-right duration-300">

        {/* Gradient header */}
        <div className={`relative bg-gradient-to-br ${gradient} px-6 pt-6 pb-20`}>
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
          <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest mb-1">Company Profile</p>
          <h2 className="text-xl font-black text-white leading-tight pr-8">{displayName}</h2>
        </div>

        {/* Logo — overlaps header */}
        <div className="relative flex justify-center -mt-10 mb-4">
          <div className="h-20 w-20 rounded-2xl bg-white shadow-xl ring-4 ring-white flex items-center justify-center overflow-hidden">
            {profile?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.logo_url}
                alt={displayName}
                className="h-full w-full object-contain p-2"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            ) : loading ? (
              <div className="h-8 w-8 rounded-full bg-slate-100 animate-pulse" />
            ) : (
              <Building2 className="h-8 w-8 text-slate-300" />
            )}
            {!profile?.logo_url && !loading && (
              <span className="absolute text-lg font-black text-slate-600">{initials}</span>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="px-6 pb-8 flex flex-col gap-4">

          {/* Loading skeleton */}
          {loading && (
            <div className="space-y-3 animate-pulse">
              <div className="h-5 bg-slate-100 rounded w-1/3" />
              <div className="h-4 bg-slate-100 rounded w-full" />
              <div className="h-4 bg-slate-100 rounded w-5/6" />
              <div className="h-4 bg-slate-100 rounded w-4/5" />
              <div className="flex gap-2 pt-2">
                <div className="h-4 bg-slate-100 rounded w-1/3" />
                <div className="h-4 bg-slate-100 rounded w-1/4" />
              </div>
            </div>
          )}

          {/* Profile data */}
          {!loading && profile && (
            <>
              {profile.industry && (
                <span className="self-start text-xs font-bold px-3 py-1 rounded-full bg-violet-100 text-violet-700">
                  {profile.industry}
                </span>
              )}

              {profile.description && (
                <p className="text-sm text-slate-600 leading-relaxed">{profile.description}</p>
              )}

              <div className="flex flex-col gap-2">
                {profile.hq && (
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <MapPin className="h-4 w-4 shrink-0 text-slate-400" />
                    <span>{profile.hq}</span>
                  </div>
                )}
                {profile.size && (
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <Users className="h-4 w-4 shrink-0 text-slate-400" />
                    <span>{profile.size}</span>
                  </div>
                )}
                {websiteUrl && (
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <Globe className="h-4 w-4 shrink-0 text-slate-400" />
                    <a
                      href={websiteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-violet-600 hover:underline truncate"
                    >
                      {websiteUrl.replace(/^https?:\/\//, '')}
                    </a>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Visit website button */}
          {websiteUrl && (
            <a
              href={websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-700 text-white text-sm font-bold transition-colors"
            >
              <Globe className="h-4 w-4" />
              Visit Website
            </a>
          )}
        </div>
      </div>
    </>
  )
}
