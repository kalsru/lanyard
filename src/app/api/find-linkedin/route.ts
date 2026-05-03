import { NextResponse } from 'next/server'

export const maxDuration = 120

type Input = { id: string; name: string; title: string | null; company: string | null; location: string | null }
type Result = { id: string; linkedin_url: string | null; avatar_url: string | null }

async function searchLinkedInUrl(name: string, company: string | null, title: string | null): Promise<string | null> {
  const serperKey = process.env.SERPER_API_KEY
  if (!serperKey) return null

  const parts = [`"${name}"`, company && `"${company}"`, title && `"${title}"`, 'site:linkedin.com/in'].filter(Boolean)
  const q = (parts as string[]).join(' ')
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, num: 5 }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const data = await res.json()
    for (const result of data.organic ?? []) {
      const link: string = result.link ?? ''
      const m = link.match(/linkedin\.com\/in\/([a-zA-Z0-9\-_%]+)/)
      if (m) return `https://www.linkedin.com/in/${m[1]}`
    }
  } catch { /* fall through */ }
  return null
}

async function findLinkedIn(attendee: Input): Promise<Result> {
  let linkedin_url = await searchLinkedInUrl(attendee.name, attendee.company, attendee.title)
  if (!linkedin_url) linkedin_url = await searchLinkedInUrl(attendee.name, attendee.company, null)
  if (!linkedin_url) linkedin_url = await searchLinkedInUrl(attendee.name, null, null)
  console.log('[linkedin]', linkedin_url ? `Found: ${linkedin_url}` : `No URL for: ${attendee.name}`)
  return { id: attendee.id, linkedin_url, avatar_url: null }
}

export async function POST(request: Request) {
  let body: { attendees?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!Array.isArray(body.attendees)) {
    return NextResponse.json({ error: 'attendees must be an array' }, { status: 400 })
  }

  const attendees = body.attendees as Input[]
  const CONCURRENCY = 5
  const results: Result[] = []

  for (let i = 0; i < attendees.length; i += CONCURRENCY) {
    const batch = await Promise.all(attendees.slice(i, i + CONCURRENCY).map(findLinkedIn))
    results.push(...batch)
  }

  return NextResponse.json({ results })
}
