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

async function scrapeLinkedInProfile(linkedInUrl: string, attendeeName: string): Promise<string | null> {
  const apiToken = process.env.BRIGHTDATA_API_TOKEN
  const datasetId = process.env.BRIGHTDATA_LINKEDIN_DATASET_ID
  if (!apiToken || !datasetId) return null

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
    if (!res.ok) return null
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

    return (p?.avatar ?? p?.profile_image_url ?? p?.img_url ?? null) as string | null
  } catch { return null }
}

// Find LinkedIn URL only (no Bright Data) — fast path used when photos=false
async function findLinkedInUrl(attendee: Input): Promise<Result> {
  let linkedin_url = await searchLinkedInUrl(attendee.name, attendee.company, attendee.title)
  if (!linkedin_url) linkedin_url = await searchLinkedInUrl(attendee.name, attendee.company, null)
  if (!linkedin_url) linkedin_url = await searchLinkedInUrl(attendee.name, null, null)
  console.log('[linkedin]', linkedin_url ? `Found: ${linkedin_url}` : `No URL for: ${attendee.name}`)
  return { id: attendee.id, linkedin_url, avatar_url: null }
}

// Find LinkedIn URL + photo — used on initial import
async function findLinkedInFull(attendee: Input): Promise<Result> {
  const { linkedin_url } = await findLinkedInUrl(attendee)
  if (!linkedin_url) return { id: attendee.id, linkedin_url: null, avatar_url: null }
  const avatar_url = await scrapeLinkedInProfile(linkedin_url, attendee.name)
  return { id: attendee.id, linkedin_url, avatar_url }
}

// Run tasks with bounded concurrency
async function parallel<T>(items: T[], fn: (item: T) => Promise<Result>, concurrency: number): Promise<Result[]> {
  const results: Result[] = []
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = await Promise.all(items.slice(i, i + concurrency).map(fn))
    results.push(...batch)
  }
  return results
}

export async function POST(request: Request) {
  // photos=false → URL-only mode (fast re-enrich); photos=true (default) → full with Bright Data
  const { searchParams } = new URL(request.url)
  const photos = searchParams.get('photos') !== 'false'

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

  let results: Result[]
  if (!photos) {
    // URL-only: 5 concurrent Serper searches, no Bright Data → fits in 120s for large lists
    results = await parallel(attendees, findLinkedInUrl, 5)
  } else {
    // Full: sequential (Serper + Bright Data per person) — keep for small initial imports
    results = []
    for (const attendee of attendees) {
      try {
        results.push(await findLinkedInFull(attendee))
      } catch (e) {
        console.error('[linkedin] Error for', attendee.name, ':', e instanceof Error ? e.message : e)
        results.push({ id: attendee.id, linkedin_url: null, avatar_url: null })
      }
    }
  }

  return NextResponse.json({ results })
}
