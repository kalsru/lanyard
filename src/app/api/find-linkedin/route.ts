import { NextResponse } from 'next/server'

export const maxDuration = 120

type Input = { id: string; name: string; title: string | null; company: string | null; location: string | null }
type Result = { id: string; linkedin_url: string | null; avatar_url: string | null }

// Search DuckDuckGo HTML for a LinkedIn profile URL — no browser needed
async function searchLinkedInUrl(name: string, company: string | null): Promise<string | null> {
  const query = [name, company, 'site:linkedin.com/in'].filter(Boolean).join(' ')
  try {
    const res = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      {
        signal: AbortSignal.timeout(10000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html',
        },
      }
    )
    if (!res.ok) return null
    const html = await res.text()

    // Extract LinkedIn profile URLs from DuckDuckGo redirect links
    const matches = [...html.matchAll(/uddg=(https?%3A%2F%2F(?:www\.)?linkedin\.com%2Fin%2F([a-zA-Z0-9\-_%]+))/g)]
    for (const m of matches) {
      try {
        const url = decodeURIComponent(m[1])
        const { hostname, pathname } = new URL(url)
        if (hostname.includes('linkedin.com') && pathname.startsWith('/in/')) {
          return `https://www.linkedin.com${pathname.split('/').slice(0, 3).join('/')}`
        }
      } catch { continue }
    }

    // Fallback: look for linkedin.com/in/ directly in HTML
    const direct = html.match(/https?:\/\/(?:www\.)?linkedin\.com\/in\/([a-zA-Z0-9\-_%]{3,80})(?:\/|"|'|&)/)
    if (direct) return `https://www.linkedin.com/in/${direct[1]}`
  } catch { /* fall through */ }
  return null
}

// Use Bright Data LinkedIn scraper to get full profile data given a URL
async function scrapeLinkedInProfile(linkedInUrl: string): Promise<{ avatar_url: string | null; title: string | null; company: string | null; location: string | null }> {
  const empty = { avatar_url: null, title: null, company: null, location: null }
  const apiToken = process.env.BRIGHTDATA_API_TOKEN
  const datasetId = process.env.BRIGHTDATA_LINKEDIN_DATASET_ID
  if (!apiToken || !datasetId) return empty

  try {
    const res = await fetch(
      `https://api.brightdata.com/datasets/v3/scrape?dataset_id=${datasetId}&notify=false&include_errors=true`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: [{ url: linkedInUrl }] }),
        signal: AbortSignal.timeout(30000),
      }
    )
    if (!res.ok) {
      console.error('[linkedin] Bright Data error:', res.status, await res.text())
      return empty
    }

    const data = await res.json()
    const p = Array.isArray(data) ? data[0] : data
    if (!p || p.error) return empty

    console.log('[linkedin] Bright Data profile keys:', Object.keys(p))

    return {
      avatar_url: p.profile_image_url ?? p.img_url ?? p.avatar ?? p.photo ?? null,
      title: p.headline ?? p.job_title ?? p.title ?? p.current_title ?? null,
      company: p.current_company_name ?? p.company ?? p.organization ?? null,
      location: p.location ?? p.city ?? null,
    }
  } catch (e) {
    console.error('[linkedin] Bright Data fetch error:', e instanceof Error ? e.message : e)
    return empty
  }
}

async function findLinkedIn(attendee: Input): Promise<Result> {
  // 1. Find LinkedIn URL via DuckDuckGo search
  let linkedin_url = await searchLinkedInUrl(attendee.name, attendee.company)
  if (!linkedin_url) linkedin_url = await searchLinkedInUrl(attendee.name, null)

  console.log('[linkedin]', linkedin_url ? `Found URL: ${linkedin_url}` : `No URL for: ${attendee.name}`)

  if (!linkedin_url) return { id: attendee.id, linkedin_url: null, avatar_url: null }

  // 2. Enrich with Bright Data to get photo + current profile data
  const profile = await scrapeLinkedInProfile(linkedin_url)

  return { id: attendee.id, linkedin_url, avatar_url: profile.avatar_url }
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

  const results: Result[] = []
  for (const attendee of body.attendees as Input[]) {
    try {
      results.push(await findLinkedIn(attendee))
    } catch (e) {
      console.error('[linkedin] Error for', attendee.name, ':', e instanceof Error ? e.message : e)
      results.push({ id: attendee.id, linkedin_url: null, avatar_url: null })
    }
  }

  return NextResponse.json({ results })
}
