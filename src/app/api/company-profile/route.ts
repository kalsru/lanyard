import { chromium } from 'playwright'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const maxDuration = 120

const EXECUTABLE_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SKIP_DOMAINS = new Set([
  'google.com', 'bing.com', 'yahoo.com', 'linkedin.com', 'facebook.com',
  'twitter.com', 'x.com', 'instagram.com', 'youtube.com', 'wikipedia.org',
  'bloomberg.com', 'crunchbase.com', 'glassdoor.com', 'indeed.com',
  'yelp.com', 'zoominfo.com', 'dnb.com', 'pitchbook.com',
])

export type CompanyProfile = {
  domain: string
  name: string | null
  description: string | null
  industry: string | null
  sic_code: string | null
  sic_description: string | null
  revenue: string | null
  employee_count: string | null
  founded_year: string | null
  hq: string | null
  logo_url: string | null
  website_url: string | null
  fetched_at?: string
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

function isSkipped(href: string): boolean {
  try {
    const bare = new URL(href).hostname.replace(/^www\./, '')
    return SKIP_DOMAINS.has(bare) || [...SKIP_DOMAINS].some((d) => bare.endsWith('.' + d))
  } catch { return true }
}

async function findWebsiteForCompany(name: string): Promise<string | null> {
  const browser = await chromium.launch({
    headless: true,
    ...(EXECUTABLE_PATH && { executablePath: EXECUTABLE_PATH }),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
  try {
    const page = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
    }).then((c) => c.newPage())

    await page.goto(
      `https://www.google.com/search?q=${encodeURIComponent(`"${name}" official website`)}&num=5`,
      { waitUntil: 'domcontentloaded', timeout: 20000 },
    )
    await page.waitForTimeout(1500)

    const candidates = await page.evaluate(() =>
      (Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[])
        .map((a) => a.href).filter((h) => h.startsWith('http') && !h.includes('google.com'))
    )
    for (const href of candidates) {
      if (!isSkipped(href)) {
        try {
          const { protocol, hostname } = new URL(href)
          if (['http:', 'https:'].includes(protocol)) return `${protocol}//${hostname}`
        } catch { continue }
      }
    }
    return null
  } finally {
    await browser.close().catch(() => {})
  }
}

async function scrapeCompany(websiteUrl: string, domain: string): Promise<CompanyProfile> {
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
    await page.goto(websiteUrl, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await page.waitForTimeout(1500)

    // Extract logo
    const logo_url = await page.evaluate((base: string) => {
      const og = document.querySelector('meta[property="og:image"]')?.getAttribute('content')
      if (og && !og.includes('placeholder') && !og.includes('default')) return og
      const apple = document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href')
      if (apple) { try { return new URL(apple, base).href } catch { return null } }
      return null
    }, websiteUrl)

    // Extract visible text from homepage (strip nav/footer noise)
    const homepageText = await page.evaluate(() => {
      const remove = ['nav', 'footer', 'header', 'script', 'style', 'noscript']
      remove.forEach((tag) => document.querySelectorAll(tag).forEach((el) => el.remove()))
      return document.body.innerText.slice(0, 4000).replace(/\s+/g, ' ').trim()
    })

    // Also try /about page for richer info
    let aboutText = ''
    try {
      const aboutPage = await context.newPage()
      const aboutUrl = `${websiteUrl}/about`
      await aboutPage.goto(aboutUrl, { waitUntil: 'domcontentloaded', timeout: 10000 })
      aboutText = await aboutPage.evaluate(() => {
        const remove = ['nav', 'footer', 'header', 'script', 'style', 'noscript']
        remove.forEach((tag) => document.querySelectorAll(tag).forEach((el) => el.remove()))
        return document.body.innerText.slice(0, 3000).replace(/\s+/g, ' ').trim()
      })
      await aboutPage.close()
    } catch { /* /about page not available */ }

    const screenshot = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1280, height: 900 } })
    const base64 = screenshot.toString('base64')

    const combinedText = [
      homepageText && `Homepage:\n${homepageText}`,
      aboutText && `About page:\n${aboutText}`,
    ].filter(Boolean).join('\n\n')

    const prompt = `You are analyzing a company. Domain: ${domain}

Page content:
${combinedText}

Extract the following and return as JSON only (no markdown, no explanation):
- name: official company name
- description: 2-3 sentences describing what the company does and who it serves
- industry: broad industry label (e.g. "Insurance", "Financial Services", "Automotive", "Technology", "Healthcare")
- sic_code: the most appropriate 4-digit Standard Industrial Classification (SIC) code based on the company's primary business activity
- sic_description: the official SIC description for that code (e.g. "Life Insurance", "State Commercial Banks-Federal Reserve Members", "Prepackaged Software")
- revenue: annual revenue if mentioned anywhere (e.g. "$2.1B", "$500M-$1B"), otherwise null
- employee_count: number of employees if mentioned (e.g. "5,000+", "10,000 employees"), otherwise null
- founded_year: year founded if mentioned (e.g. "1913"), otherwise null
- hq: headquarters city and state/country (e.g. "New York, NY", "London, UK"), otherwise null

SIC code reference examples:
6311=Life Insurance, 6321=Accident & Health Insurance, 6411=Insurance Agents/Brokers
6021=State Commercial Banks, 6022=State Savings Institutions, 6141=Personal Credit
6159=Federal Credit Agencies, 6199=Finance Services
5511=New & Used Car Dealers, 5521=Used Car Dealers
7372=Prepackaged Software, 7371=Computer Programming, 7374=Data Processing
8000=Health Services, 8011=Offices of Physicians, 8049=Offices of Other Health Practitioners
6531=Real Estate Dealers, 6552=Land Subdividers & Developers
5900=Retail Stores, 5300=General Merchandise Stores

Return JSON only: {"name":"...","description":"...","industry":"...","sic_code":"...","sic_description":"...","revenue":null,"employee_count":null,"founded_year":null,"hq":"..."}`

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } },
            { type: 'text', text: prompt },
          ],
        },
      ],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text : '{}'
    const match = text.match(/\{[\s\S]*\}/)
    const parsed = match ? JSON.parse(match[0]) : {}

    return {
      domain,
      name: parsed.name ?? null,
      description: parsed.description ?? null,
      industry: parsed.industry ?? null,
      sic_code: parsed.sic_code ? String(parsed.sic_code) : null,
      sic_description: parsed.sic_description ?? null,
      revenue: parsed.revenue ?? null,
      employee_count: parsed.employee_count ?? null,
      founded_year: parsed.founded_year ? String(parsed.founded_year) : null,
      hq: parsed.hq ?? null,
      logo_url: logo_url ?? null,
      website_url: websiteUrl,
    }
  } finally {
    await browser.close().catch(() => {})
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const urlParam = searchParams.get('url')?.trim() || null
  const name = searchParams.get('name')?.trim() || null
  const refresh = searchParams.get('refresh') === 'true'

  if (!urlParam && !name) return NextResponse.json({ error: 'url or name is required' }, { status: 400 })

  let websiteUrl: string | null = null
  if (urlParam) {
    try {
      const p = new URL(urlParam)
      websiteUrl = `${p.protocol}//${p.hostname}`
    } catch {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
    }
  }

  const domain = websiteUrl ? extractDomain(websiteUrl) : (name ?? '')
  const supabase = getSupabase()

  // Check cache
  if (!refresh) {
    const { data: cached } = await supabase
      .from('company_profiles')
      .select('*')
      .eq('domain', domain)
      .single()

    if (cached?.description) {
      const ageMs = Date.now() - new Date(cached.fetched_at).getTime()
      if (ageMs < 30 * 24 * 60 * 60 * 1000) return NextResponse.json(cached)
    }
  }

  try {
    // Find URL via Google if not provided
    if (!websiteUrl) {
      websiteUrl = await findWebsiteForCompany(name!)
      if (!websiteUrl) {
        return NextResponse.json({
          domain, name, description: null, industry: null, sic_code: null,
          sic_description: null, revenue: null, employee_count: null,
          founded_year: null, hq: null, logo_url: null, website_url: null,
        })
      }
    }

    const profile = await scrapeCompany(websiteUrl, domain)
    await supabase.from('company_profiles').upsert({ ...profile, fetched_at: new Date().toISOString() })
    return NextResponse.json(profile)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[company-profile] Error:', message)
    return NextResponse.json(
      { domain, name, description: null, industry: null, sic_code: null, sic_description: null,
        revenue: null, employee_count: null, founded_year: null, hq: null, logo_url: null,
        website_url: websiteUrl, error: message },
      { status: 500 },
    )
  }
}
