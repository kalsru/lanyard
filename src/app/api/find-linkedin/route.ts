import { NextResponse } from 'next/server'

export const maxDuration = 120

type Input = { id: string; name: string; title: string | null; company: string | null; location: string | null }
type Result = { id: string; linkedin_url: string | null; avatar_url: string | null }

// Search Google via Serper.dev for a LinkedIn profile URL
async function searchLinkedInUrl(name: string, company: string | null, title: string | null): Promise<string | null> {
  const serperKey = process.env.SERPER_API_KEY
  if (!serperKey) return null

  const parts = [`"${name}"`, company && `"${company}"`, title && `"${title}"`, 'site:linkedin.com/in'].filter(Boolean)
  const q = parts.join(' ')
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

// Use Bright Data to scrape a LinkedIn profile URL — returns avatar and whether name verified
async function scrapeLinkedInProfile(linkedInUrl: string, attendeeName: string): Promise<{ avatar_url: string | null; verified: boolean }> {
  const apiToken = process.env.BRIGHTDATA_API_TOKEN
  const datasetId = process.env.BRIGHTDATA_LINKEDIN_DATASET_ID
  if (!apiToken || !datasetId) return { avatar_url: null, verified: false }

  try {
    const res = await fetch(
      `https://api.brightdata.com/datasets/v3/scrape?dataset_id=${datasetId}&notify=false&include_errors=true`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: [{ url: linkedInUrl }] }),
        signal: AbortSignal.timeout(45000),
      }
    )
    if (!res.ok) return { avatar_url: null, verified: false }
    const data = await res.json()
    const results: unknown[] = Array.isArray(data) ? data : [data]

    const nameLower = attendeeName.toLowerCase()
    const [first, ...rest] = nameLower.split(' ')
    const last = rest[rest.length - 1] ?? ''
    const p = results.find((r: unknown) => {
      if (!r || typeof r !== 'object') return false
      const row = r as Record<string, unknown>
      if (row.error) return false
      const rName = String(row.name ?? '').toLowerCase()
      return rName.includes(first) && (!last || rName.includes(last))
    }) as Record<string, unknown> | undefined

    if (!p) return { avatar_url: null, verified: false }
    return {
      avatar_url: (p.avatar ?? p.profile_image_url ?? p.img_url ?? null) as string | null,
      verified: true,
    }
  } catch { return { avatar_url: null, verified: false } }
}

async function findLinkedIn(attendee: Input): Promise<Result> {
  // 1. Find LinkedIn URL — try with company+title, then company only, then name only
  let linkedin_url = await searchLinkedInUrl(attendee.name, attendee.company, attendee.title)
  if (!linkedin_url) linkedin_url = await searchLinkedInUrl(attendee.name, attendee.company, null)
  if (!linkedin_url) linkedin_url = await searchLinkedInUrl(attendee.name, null, null)

  console.log('[linkedin]', linkedin_url ? `Found: ${linkedin_url}` : `No URL for: ${attendee.name}`)
  if (!linkedin_url) return { id: attendee.id, linkedin_url: null, avatar_url: null }

  // 2. Scrape profile via Bright Data — verify name matches before trusting the URL
  const { avatar_url, verified } = await scrapeLinkedInProfile(linkedin_url, attendee.name)

  if (!verified) {
    console.log('[linkedin] Name mismatch, discarding URL for:', attendee.name)
    return { id: attendee.id, linkedin_url: null, avatar_url: null }
  }

  return { id: attendee.id, linkedin_url, avatar_url }
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
