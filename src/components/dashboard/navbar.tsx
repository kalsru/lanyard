'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Profile } from '@/types/database'
import { LanyardLogo, LanyardWordmark } from './logo'

const navLinks = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/attendees', label: 'Attendees' },
]

export function Navbar({ profile }: { profile: Profile | null }) {
  const router = useRouter()
  const pathname = usePathname()

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const initials = profile?.full_name
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase() ?? '?'

  return (
    <header className="bg-white border-b border-slate-100 shadow-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">

        {/* Logo + nav */}
        <div className="flex items-center gap-8">
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <LanyardLogo size={34} />
            <LanyardWordmark className="text-xl" />
          </Link>

          <nav className="hidden sm:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                  pathname === link.href
                    ? 'bg-violet-50 text-violet-700'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger className="rounded-full focus:outline-none focus:ring-2 focus:ring-violet-400 focus:ring-offset-2">
            <Avatar className="h-9 w-9 cursor-pointer ring-2 ring-violet-200">
              <AvatarImage src={profile?.avatar_url ?? ''} alt={profile?.full_name ?? ''} />
              <AvatarFallback className="bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white font-bold text-sm">
                {initials}
              </AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <div className="px-2 py-2">
              <p className="text-sm font-semibold">{profile?.full_name ?? 'User'}</p>
              <p className="text-xs text-muted-foreground">{profile?.email}</p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut} className="text-rose-600 focus:text-rose-600 focus:bg-rose-50 font-medium">
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

      </div>
    </header>
  )
}
