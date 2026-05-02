import { NextResponse } from 'next/server'

export const maxDuration = 120

type Input = { id: string; name: string; title: string | null; company: string | null; location: string | null }
type Result = { id: string; linkedin_url: string | null; avatar_url: string | null }

// Generate plausible LinkedIn person slug variants from a full name
function personSlugs(name: string): string[] {
  const parts = name.toLowerCase().trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2) return [parts[0] ?? '']
  const [first, ...rest] = parts
  const last = rest[rest.length - 1]
  const middle = rest.length > 1 ? rest[0] : null
  const slugs: string[] = [
    `${first}-${last}`,
    `${first}${last}`,
    middle ? `${first}-${middle[0]}-${last}` : null,
    `${first}-${rest.join('-')}`,
  ].filter((s): s is string => !!s && s.length > 2)
  return [...new Set(slugs)]
}

// Use Bright Data to scrape LinkedIn people profiles — tries slug variants, picks name match
async function scrapeLinkedInProfile(attendeeName: string, knownUrl?: string | null): Promise<{ linkedin_url: string | null; avatar_url: string | null }> {
  const empty = { linkedin_url: null, avatar_url: null }
  const apiToken = process.env.BRIGHTDATA_API_TOKEN
  const datasetId = process.env.BRIGHTDATA_LINKEDIN_DATASET_ID
  if (!apiToken || !datasetId) return empty

  const urls = knownUrl
    ? [{ url: knownUrl }]
    : personSlugs(attendeeName).map((s) => ({ url: `https://www.linkedin.com/in/${s}` }))

  try {
    const res = await fetch(
      `https://api.brightdata.com/datasets/v3/scrape?dataset_id=${datasetId}&notify=false&include_errors=true`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: urls }),
        signal: AbortSignal.timeout(45000),
      }
    )
    if (!res.ok) { console.error('[linkedin] BD error:', res.status); return empty }

    const data = await res.json()
    const results: unknown[] = Array.isArray(data) ? data : [data]

    // Find result whose name roughly matches the attendee (avoids wrong person on slug collision)
    const nameLower = attendeeName.toLowerCase()
    const p = results.find((r: unknown) => {
      if (!r || typeof r !== 'object') return false
      const row = r as Record<string, unknown>
      if (row.error) return false
      const rName = String(row.name ?? '').toLowerCase()
      if (!rName) return false
      const [first, ...rest] = nameLower.split(' ')
      const last = rest[rest.length - 1] ?? ''
      return rName.includes(first) && (!last || rName.includes(last))
    }) as Record<string, unknown> | undefined

    if (!p) return empty

    const linkedin_url = knownUrl ?? `https://www.linkedin.com/in/${personSlugs(attendeeName)[0]}`
    return {
      linkedin_url,
      avatar_url: (p.avatar ?? p.profile_image_url ?? p.img_url ?? null) as string | null,
    }
  } catch (e) {
    console.error('[linkedin] BD fetch error:', e instanceof Error ? e.message : e)
    return empty
  }
}

async function findLinkedIn(attendee: Input): Promise<Result> {
  const { linkedin_url, avatar_url } = await scrapeLinkedInProfile(attendee.name)
  console.log('[linkedin]', linkedin_url ? `Found: ${linkedin_url}` : `No match for: ${attendee.name}`)
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
