import { chromium } from 'playwright'
import { NextResponse } from 'next/server'

export const maxDuration = 120

const EXECUTABLE_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined

// Domains that are never a company's own website
const SKIP_DOMAINS = new Set([
  'bing.com', 'google.com', 'yahoo.com', 'duckduckgo.com',
  'linkedin.com', 'facebook.com', 'twitter.com', 'x.com', 'instagram.com',
  'youtube.com', 'wikipedia.org', 'wikimedia.org',
  'bloomberg.com', 'crunchbase.com', 'glassdoor.com', 'indeed.com',
  'yelp.com', 'yellowpages.com', 'bbb.org', 'zoominfo.com',
  'dnb.com', 'hoovers.com', 'owler.com', 'pitchbook.com',
  'manta.com', 'bizbuysell.com', 'mapquest.com',
])

function isSkipped(href: string): boolean {
  try {
    const { hostname } = new URL(href)
    const bare = hostname.replace(/^www\./, '')
    return SKIP_DOMAINS.has(bare) || [...SKIP_DOMAINS].some((d) => bare.endsWith('.' + d))
  } catch {
    return true
  }
}

function normalizeOrigin(href: string): string | null {
  try {
    const { protocol, hostname } = new URL(href)
    if (!['http:', 'https:'].includes(protocol)) return null
    return `${protocol}//${hostname}`
  } catch {
    return null
  }
}

async function findCompanyUrl(company: string): Promise<string | null> {
  const query = `"${company}" official website`
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=5`

  console.log('[company-url] Searching:', company)

  const browser = await chromium.launch({
    headless: true,
    ...(EXECUTABLE_PATH && { executablePath: EXECUTABLE_PATH }),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
    })
    const page = await context.newPage()
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await page.waitForTimeout(1500)

    const candidates = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[]
      return links.map((a) => a.href).filter((h) => h.startsWith('http') && !h.includes('google.com'))
    })

    for (const href of candidates) {
      if (!isSkipped(href)) {
        const origin = normalizeOrigin(href)
        if (origin) {
          console.log('[company-url] Found:', origin, 'for', company)
          return origin
        }
      }
    }

    console.log('[company-url] No result for:', company)
    return null
  } finally {
    await browser.close().catch(() => {})
  }
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

  const attendees = body.attendees as { id: string; company: string | null }[]
  const results: { id: string; company_url: string | null }[] = []

  for (const { id, company } of attendees) {
    if (!company) {
      results.push({ id, company_url: null })
      continue
    }
    try {
      results.push({ id, company_url: await findCompanyUrl(company) })
    } catch (e) {
      console.error('[company-url] Error for', company, ':', e instanceof Error ? e.message : e)
      results.push({ id, company_url: null })
    }
  }

  return NextResponse.json({ results })
}
