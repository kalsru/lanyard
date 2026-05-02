import { chromium } from 'playwright'
import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'

export const maxDuration = 120

const EXECUTABLE_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

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

async function extractViaVision(screenshots: { data: string; mediaType: 'image/png' }[]): Promise<AttendeeRow[]> {
  const imageContent = screenshots.map((s) => ({
    type: 'image' as const,
    source: { type: 'base64' as const, media_type: s.mediaType, data: s.data },
  }))

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          ...imageContent,
          {
            type: 'text',
            text: `Extract every person/attendee/speaker visible in these screenshots.
For each person return a JSON array with:
- name (full name, required)
- title (job title or role, null if not visible)
- company (organization or employer — this is often shown below the title, null if not visible)
- company_url (company website URL if a hyperlink is visible, otherwise null)
- location (city/state/country if visible, null if not)
- tags (any badge labels like "Speaker", "Sponsor" etc., empty array if none)

IMPORTANT: company is often the 3rd line of text under a person's photo (after name and title). Extract it even if it has no special styling.

Return ONLY a valid JSON array, no markdown, no explanation.
Example: [{"name":"Jane Smith","title":"CTO","company":"Acme Corp","company_url":null,"location":null,"tags":[]}]`,
          },
        ],
      },
    ],
  })

  const text = message.content[0].type === 'text' ? message.content[0].text : ''
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) return []

  const parsed = JSON.parse(match[0]) as Omit<AttendeeRow, 'id' | 'avatar_url'>[]
  return parsed.map((a) => ({ ...a, id: Math.random().toString(36).slice(2), avatar_url: null }))
}

export async function POST(request: Request) {
  let body: { url?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const url = typeof body.url === 'string' ? body.url.trim() : ''
  if (!url) return NextResponse.json({ error: 'url is required' }, { status: 400 })

  try { new URL(url) } catch {
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
    await page.waitForTimeout(2000)

    const finalUrl = page.url()
    if (/login|sign_in|signin/i.test(finalUrl)) {
      return NextResponse.json({ error: 'This page requires login.', attendees: [] }, { status: 403 })
    }

    // Scroll to trigger lazy-loaded images
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await page.waitForTimeout(600)
    }
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(500)

    // --- DOM extraction (fast path) ---
    const domAttendees: AttendeeRow[] = await page.evaluate((pageUrl: string) => {
      function toAbsolute(src: string): string | null {
        if (!src || src.startsWith('data:')) return null
        try { return new URL(src, pageUrl).href } catch { return null }
      }

      function getImgSrc(img: HTMLImageElement): string | null {
        return img.getAttribute('data-src') ||
          img.getAttribute('data-lazy-src') ||
          img.getAttribute('data-original') ||
          img.getAttribute('data-lazy') ||
          (img.src && !img.src.endsWith('/') ? img.src : null)
      }

      function textOf(el: Element | null): string | null {
        return el?.textContent?.trim() || null
      }

      const results: AttendeeRow[] = []
      const seen = new Set<string>()

      const selectors = [
        '[class*="speaker"]', '[class*="attendee"]', '[class*="member"]',
        '[class*="person"]', '[class*="profile"]', '[class*="user-card"]',
        '[class*="contact"]', 'li[class*="card"]', 'article',
      ]

      for (const selector of selectors) {
        const cards = Array.from(document.querySelectorAll(selector))
        if (cards.length < 2) continue

        for (const card of cards) {
          const nameEl = card.querySelector('h1,h2,h3,h4,h5,[class*="name"],strong')
          const name = textOf(nameEl)
          if (!name || name.length < 2 || name.length > 80) continue
          if (seen.has(name.toLowerCase())) continue
          seen.add(name.toLowerCase())

          // All direct text-bearing children (leaf nodes), excluding the name element
          const textNodes = Array.from(card.querySelectorAll('p,span,div,small,em,i'))
            .filter((el) => {
              if (el === nameEl || el.contains(nameEl as Node)) return false
              if (el.querySelector('p,div,h1,h2,h3,h4,h5')) return false
              return (el.textContent?.trim().length ?? 0) > 0
            })

          const title = textOf(textNodes[0] ?? null)

          // Company: prefer semantic class, else second text node
          const companyEl = card.querySelector('[class*="company"],[class*="org"],[class*="employer"],[class*="affiliation"]')
          const company = textOf(companyEl) ?? textOf(textNodes[1] ?? null)

          const companyLinkEl = (companyEl?.querySelector('a') ?? null) as HTMLAnchorElement | null
          const company_url = companyLinkEl ? toAbsolute(companyLinkEl.href) : null

          const locationEl = card.querySelector('[class*="location"],[class*="city"],[class*="region"],[class*="country"]')
          const location = textOf(locationEl)

          const imgEl = card.querySelector('img') as HTMLImageElement | null
          const rawSrc = imgEl ? getImgSrc(imgEl) : null
          const avatar_url = rawSrc ? toAbsolute(rawSrc) : null

          results.push({
            id: Math.random().toString(36).slice(2),
            name, title, company, company_url, location,
            tags: [], avatar_url,
          })
        }

        if (results.length > 0) break
      }

      return results

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      type AttendeeRow = {
        id: string; name: string; title: string | null; company: string | null
        company_url: string | null; location: string | null; tags: string[]; avatar_url: string | null
      }
    }, url)

    // If DOM extraction got attendees with company data, return them
    const domHasCompany = domAttendees.some((a) => a.company)
    if (domAttendees.length > 0 && domHasCompany) {
      return NextResponse.json({ attendees: domAttendees })
    }

    // --- Vision fallback: screenshot + Claude ---
    console.log('[scrape] DOM extraction insufficient, falling back to vision')

    const pageHeight: number = await page.evaluate(() => document.body.scrollHeight)
    const viewHeight = 900
    const screenshots: { data: string; mediaType: 'image/png' }[] = []

    // Capture up to 4 viewport-sized screenshots scrolling down
    for (let scrollY = 0; scrollY < Math.min(pageHeight, viewHeight * 4); scrollY += viewHeight) {
      await page.evaluate((y: number) => window.scrollTo(0, y), scrollY)
      await page.waitForTimeout(400)
      const buf = await page.screenshot({ type: 'png' })
      screenshots.push({ data: buf.toString('base64'), mediaType: 'image/png' })
    }

    // Extract text data via vision
    const visionAttendees = await extractViaVision(screenshots)

    if (visionAttendees.length === 0) {
      // Return DOM results even without company rather than nothing
      if (domAttendees.length > 0) return NextResponse.json({ attendees: domAttendees })
      return NextResponse.json({
        error: 'No attendees found. The page may require login or use an unsupported format.',
        attendees: [],
      })
    }

    // Enrich vision results with avatar_url from DOM extraction (match by name)
    const domByName = new Map(domAttendees.map((a) => [a.name.toLowerCase(), a]))
    const enriched = visionAttendees.map((a) => {
      const dom = domByName.get(a.name.toLowerCase())
      return { ...a, avatar_url: dom?.avatar_url ?? null }
    })

    return NextResponse.json({ attendees: enriched })

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[scrape] Error:', message)
    return NextResponse.json({ error: `Failed to scrape page: ${message}`, attendees: [] }, { status: 500 })
  } finally {
    await browser.close().catch(() => {})
  }
}
