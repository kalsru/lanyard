import { chromium } from 'playwright'
import { NextResponse } from 'next/server'

export const maxDuration = 60

const EXECUTABLE_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined

export async function POST(request: Request) {
  let body: { url?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const url = typeof body.url === 'string' ? body.url.trim() : ''
  if (!url) {
    return NextResponse.json({ error: 'url is required' }, { status: 400 })
  }

  try {
    new URL(url) // validate URL format
  } catch {
    return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 })
  }

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
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(3000)

    const finalUrl = page.url()
    if (/login|sign_in|signin/i.test(finalUrl)) {
      return NextResponse.json({
        error: 'This page requires login. Only publicly accessible attendee pages are supported.',
        attendees: [],
      }, { status: 403 })
    }

    // Scroll to trigger lazy-loaded content
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await page.waitForTimeout(800)
    }
    await page.evaluate(() => window.scrollTo(0, 0))

    type AttendeeRow = {
      id: string
      name: string
      title: string | null
      company: string | null
      company_url: string | null
      location: string | null
      tags: string[]
      avatar_url: string | null
    }

    const attendees: AttendeeRow[] = await page.evaluate(() => {
      const results: AttendeeRow[] = []
      const selectors = [
        '[class*="attendee"]', '[class*="member"]', '[class*="speaker"]',
        '[class*="person"]', '[class*="profile-card"]', '[class*="user-card"]',
        '[class*="contact"]', 'li[class*="card"]', 'article',
      ]

      for (const selector of selectors) {
        const cards = document.querySelectorAll(selector)
        if (cards.length < 2) continue

        cards.forEach((card) => {
          const nameEl = card.querySelector('h2, h3, h4, h5, [class*="name"], strong')
          const name = nameEl?.textContent?.trim()
          if (!name || name.length < 2 || name.length > 80) return

          const titleEl = card.querySelector('[class*="title"], [class*="role"], [class*="job"], p')
          const companyEl = card.querySelector('[class*="company"], [class*="org"]')
          const companyLinkEl = card.querySelector('[class*="company"] a, [class*="org"] a') as HTMLAnchorElement | null
          const locationEl = card.querySelector('[class*="location"], [class*="city"], [class*="region"]')
          const imgEl = card.querySelector('img')

          results.push({
            id: Math.random().toString(36).slice(2),
            name,
            title: titleEl?.textContent?.trim() ?? null,
            company: companyEl?.textContent?.trim() ?? null,
            company_url: companyLinkEl?.href ?? null,
            location: locationEl?.textContent?.trim() ?? null,
            tags: [],
            avatar_url: imgEl?.getAttribute('src') ?? null,
          })
        })

        if (results.length > 0) break
      }

      return results

      // TypeScript declaration for evaluate scope
      type AttendeeRow = {
        id: string; name: string; title: string | null; company: string | null
        company_url: string | null; location: string | null; tags: string[]; avatar_url: string | null
      }
    })

    if (attendees.length === 0) {
      return NextResponse.json({
        error: 'No attendees found on this page. The page may require login or use an unsupported format.',
        attendees: [],
      })
    }

    return NextResponse.json({ attendees })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[scrape] Error:', message)
    return NextResponse.json({ error: `Failed to scrape page: ${message}`, attendees: [] }, { status: 500 })
  } finally {
    await browser.close().catch(() => {})
  }
}
