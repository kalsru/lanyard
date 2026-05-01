import { chromium } from 'playwright'
import { NextResponse } from 'next/server'

export const maxDuration = 120

const EXECUTABLE_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined

type Input = { id: string; name: string; title: string | null; company: string | null; location: string | null }
type Result = { id: string; linkedin_url: string | null; avatar_url: string | null }

function launchBrowser() {
  return chromium.launch({
    headless: true,
    ...(EXECUTABLE_PATH && { executablePath: EXECUTABLE_PATH }),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
}

const BROWSER_CONTEXT = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  viewport: { width: 1280, height: 900 } as const,
}

async function searchForLinkedIn(name: string, extras: string[]): Promise<string | null> {
  const query = [`"${name}"`, ...extras, 'site:linkedin.com/in'].join(' ')
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=5`

  console.log('[linkedin] Query:', query)

  const browser = await launchBrowser()
  try {
    const page = await browser.newContext(BROWSER_CONTEXT).then((c) => c.newPage())
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await page.waitForTimeout(1500)

    return await page.evaluate(() => {
      for (const a of Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[]) {
        const m = a.href.match(/https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([a-zA-Z0-9\-_%]{3,})/)
        if (m) return `https://www.linkedin.com/in/${m[1]}`
      }
      return null
    })
  } finally {
    await browser.close().catch(() => {})
  }
}

async function fetchProfileImage(linkedInUrl: string): Promise<string | null> {
  const browser = await launchBrowser()
  try {
    const page = await browser.newContext(BROWSER_CONTEXT).then((c) => c.newPage())
    // Short timeout — we only need the initial HTML, not full page render
    await page.goto(linkedInUrl, { waitUntil: 'domcontentloaded', timeout: 12000 })

    const imageUrl = await page.evaluate(() => {
      const og = document.querySelector('meta[property="og:image"]')
      return og?.getAttribute('content') ?? null
    })

    // LinkedIn's placeholder ghost images aren't useful
    if (imageUrl && !imageUrl.includes('ghost') && !imageUrl.includes('static')) {
      console.log('[linkedin] Profile image found for', linkedInUrl)
      return imageUrl
    }
    return null
  } catch {
    return null
  } finally {
    await browser.close().catch(() => {})
  }
}

async function findLinkedIn(attendee: Input): Promise<Result> {
  const extras = [attendee.company, attendee.location].filter(Boolean) as string[]

  let linkedin_url = extras.length ? await searchForLinkedIn(attendee.name, extras) : null
  if (!linkedin_url) linkedin_url = await searchForLinkedIn(attendee.name, [])

  console.log('[linkedin]', linkedin_url ? `Found: ${linkedin_url}` : `No result for: ${attendee.name}`)

  let avatar_url: string | null = null
  if (linkedin_url) {
    avatar_url = await fetchProfileImage(linkedin_url)
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
