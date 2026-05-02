import { Card } from '@/components/ui/card'

export type Attendee = {
  id: string
  name: string
  title: string | null
  company: string | null
  location: string | null
  tags: string[]
  avatar_url?: string | null
  linkedin_url?: string | null
  company_url?: string | null
}

const TAG_CONFIG: Record<string, { label: string; card: string; badge: string; header: string }> = {
  Speakers:     { label: 'Speaker',   card: 'ring-violet-300',  badge: 'bg-violet-600 text-white',  header: 'from-violet-600 to-indigo-700' },
  Sponsors:     { label: 'Sponsor',   card: 'ring-orange-300',  badge: 'bg-orange-500 text-white',  header: 'from-orange-500 to-rose-600'   },
  'Whova Loyal':{ label: 'Loyal',     card: 'ring-fuchsia-300', badge: 'bg-fuchsia-600 text-white', header: 'from-fuchsia-600 to-pink-600'  },
}

const DEFAULT_HEADER = 'from-slate-700 to-slate-900'

const AVATAR_COLORS = [
  'from-fuchsia-500 to-pink-600',
  'from-violet-500 to-indigo-600',
  'from-emerald-400 to-cyan-600',
  'from-orange-500 to-rose-500',
  'from-amber-400 to-orange-600',
  'from-sky-500 to-blue-700',
  'from-rose-500 to-fuchsia-600',
  'from-teal-400 to-emerald-600',
]

function avatarColor(name: string) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function LinkedInIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current" aria-hidden>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  )
}

export function AttendeeCard({ attendee, onCompanyClick }: { attendee: Attendee; onCompanyClick?: (name: string, url: string | null) => void }) {
  const initials = attendee.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)

  const topTag = attendee.tags?.find((t) => TAG_CONFIG[t])
  const tagCfg = topTag ? TAG_CONFIG[topTag] : null
  const headerGradient = tagCfg?.header ?? DEFAULT_HEADER
  const ringClass = tagCfg?.card ?? 'ring-slate-200'

  const displayCompany = attendee.company && attendee.location
    ? attendee.company.replace(new RegExp(`\\s*[-–—·|]+\\s*${attendee.location.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*$`, 'i'), '').trim() || attendee.company
    : attendee.company

  const displayTitle = attendee.title && displayCompany
    ? attendee.title.trim().toLowerCase() === displayCompany.trim().toLowerCase()
      ? null
      : attendee.title.replace(new RegExp(`[\\s\\-–—·|at]+${displayCompany.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'), '').trim() || null
    : attendee.title

  const linkedInKeywords = [attendee.name, displayCompany, attendee.location].filter(Boolean).join(' ')
  const linkedInUrl = attendee.linkedin_url
    ?? `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(linkedInKeywords)}`

  return (
    <Card className={`group overflow-hidden ring-1 ${ringClass} hover:shadow-xl hover:-translate-y-1 transition-all duration-200`}>

      {/* Coloured header */}
      <div className={`relative bg-gradient-to-br ${headerGradient} px-4 pt-5 pb-10`}>
        {tagCfg && (
          <span className={`absolute top-3 right-3 text-[10px] font-bold px-2 py-0.5 rounded-full ${tagCfg.badge} shadow-sm`}>
            {tagCfg.label}
          </span>
        )}
        {attendee.tags?.filter((t) => !TAG_CONFIG[t]).map((tag) => (
          <span key={tag} className="absolute top-3 left-3 text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/20 text-white">
            {tag}
          </span>
        ))}
      </div>

      {/* Avatar — overlaps header */}
      <div className="relative flex justify-center -mt-8 mb-3">
        <div className={`h-16 w-16 rounded-2xl bg-gradient-to-br ${avatarColor(attendee.name)} shadow-lg ring-4 ring-white flex items-center justify-center overflow-hidden`}>
          {attendee.avatar_url
            ? <img src={attendee.avatar_url} alt={attendee.name} className="h-full w-full object-cover" />
            : <span className="text-lg font-black text-white tracking-wide">{initials}</span>
          }
        </div>
      </div>

      {/* Body */}
      <div className="px-4 pb-4 flex flex-col items-center text-center">
        <p className="font-bold text-sm leading-tight mb-0.5">{attendee.name}</p>

        {displayTitle && (
          <p className="text-[11px] text-muted-foreground line-clamp-2 mb-1">{displayTitle}</p>
        )}

        {displayCompany && (
          <button
            onClick={() => onCompanyClick?.(displayCompany, attendee.company_url ?? null)}
            className="text-xs font-semibold text-primary hover:underline mb-1 truncate max-w-full cursor-pointer"
          >
            {displayCompany}
          </button>
        )}

        {attendee.location && (
          <p className="text-[11px] text-muted-foreground mb-3">📍 {attendee.location}</p>
        )}

        <a
          href={linkedInUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-auto flex items-center justify-center gap-1.5 w-full py-2 rounded-xl bg-[#0A66C2] hover:bg-[#004182] text-white text-xs font-bold transition-colors shadow-sm"
        >
          <LinkedInIcon />
          LinkedIn Profile
        </a>
      </div>
    </Card>
  )
}
