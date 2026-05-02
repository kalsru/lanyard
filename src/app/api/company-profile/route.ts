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

type WikidataResult = {
  website: string | null
  revenue: string | null
  employee_count: string | null
  founded_year: string | null
  hq: string | null
}

type LinkedInCompanyResult = {
  name: string | null
  description: string | null
  employee_count: string | null
  hq: string | null
  logo_url: string | null
  website_url: string | null
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

function formatMoney(amount: string, unit: string): string | null {
  const num = Math.abs(parseFloat(amount))
  if (isNaN(num) || num === 0) return null
  const symbol = unit.includes('Q4916') ? '€' : unit.includes('Q25224') ? '£' : '$'
  if (num >= 1e9) return `${symbol}${(num / 1e9).toFixed(1)}B`
  if (num >= 1e6) return `${symbol}${(num / 1e6).toFixed(0)}M`
  return `${symbol}${num.toLocaleString()}`
}

function formatEmployees(amount: string): string | null {
  const num = Math.round(parseFloat(amount))
  if (isNaN(num) || num === 0) return null
  if (num >= 1000) return `${(num / 1000).toFixed(0)}K+`
  return String(num)
}

// Looks up a company in Wikidata and returns structured data from the knowledge graph
async function lookupWikidata(name: string): Promise<WikidataResult> {
  const empty: WikidataResult = { website: null, revenue: null, employee_count: null, founded_year: null, hq: null }
  try {
    const searchRes = await fetch(
      `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&type=item&format=json&limit=3&origin=*`,
      { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Lanyard/1.0' } }
    )
    if (!searchRes.ok) return empty
    const searchData = await searchRes.json()

    for (const entity of searchData.search ?? []) {
      const entityRes = await fetch(
        `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${entity.id}&props=claims|labels&languages=en&format=json&origin=*`,
        { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Lanyard/1.0' } }
      )
      if (!entityRes.ok) continue
      const entityData = await entityRes.json()
      const wd = entityData.entities?.[entity.id]
      if (!wd) continue
      const claims = wd.claims ?? {}

      // P856 = official website
      const p856 = claims.P856?.[0]?.mainsnak?.datavalue?.value
      let website: string | null = null
      if (p856 && !isSkipped(p856)) {
        try {
          const { protocol, hostname } = new URL(p856)
          if (['http:', 'https:'].includes(protocol)) website = `${protocol}//${hostname}`
        } catch { /* skip */ }
      }

      // P2139 = total revenue (monetary amount)
      let revenue: string | null = null
      const revClaim = claims.P2139?.[0]?.mainsnak?.datavalue?.value
      if (revClaim?.amount) revenue = formatMoney(revClaim.amount, revClaim.unit ?? '')

      // P1128 = employees (quantity)
      let employee_count: string | null = null
      const empClaim = claims.P1128?.[0]?.mainsnak?.datavalue?.value
      if (empClaim?.amount) employee_count = formatEmployees(empClaim.amount)

      // P571 = inception date
      let founded_year: string | null = null
      const incClaim = claims.P571?.[0]?.mainsnak?.datavalue?.value
      if (incClaim?.time) {
        const m = incClaim.time.match(/\+(\d{4})/)
        if (m) founded_year = m[1]
      }

      // P159 = headquarters location (item reference → fetch label)
      let hq: string | null = null
      const hqId = claims.P159?.[0]?.mainsnak?.datavalue?.value?.id
      if (hqId) {
        try {
          const hqRes = await fetch(
            `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${hqId}&props=labels&languages=en&format=json&origin=*`,
            { signal: AbortSignal.timeout(5000), headers: { 'User-Agent': 'Lanyard/1.0' } }
          )
          if (hqRes.ok) {
            const hqData = await hqRes.json()
            hq = hqData.entities?.[hqId]?.labels?.en?.value ?? null
          }
        } catch { /* skip */ }
      }

      // Only return if this looks like a company (has website or revenue or employees)
      if (website || revenue || employee_count) {
        return { website, revenue, employee_count, founded_year, hq }
      }
    }
  } catch { /* fall through */ }
  return empty
}

// Search DuckDuckGo for a LinkedIn company page URL
async function findLinkedInCompanyUrl(name: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`${name} site:linkedin.com/company`)}`,
      { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' } }
    )
    if (!res.ok) return null
    const html = await res.text()
    const matches = [...html.matchAll(/uddg=(https?%3A%2F%2F(?:www\.)?linkedin\.com%2Fcompany%2F([a-zA-Z0-9\-_%]+))/g)]
    for (const m of matches) {
      try {
        const url = decodeURIComponent(m[1])
        const { hostname, pathname } = new URL(url)
        if (hostname.includes('linkedin.com') && pathname.startsWith('/company/')) {
          return `https://www.linkedin.com${pathname.split('/').slice(0, 3).join('/')}`
        }
      } catch { continue }
    }
    const direct = html.match(/https?:\/\/(?:www\.)?linkedin\.com\/company\/([a-zA-Z0-9\-_%]{2,80})(?:\/|"|'|&)/)
    if (direct) return `https://www.linkedin.com/company/${direct[1]}`
  } catch { /* fall through */ }
  return null
}

// Use Bright Data LinkedIn company scraper to get structured company data
async function scrapeLinkedInCompany(linkedInUrl: string): Promise<LinkedInCompanyResult> {
  const empty: LinkedInCompanyResult = { name: null, description: null, employee_count: null, hq: null, logo_url: null, website_url: null }
  const apiToken = process.env.BRIGHTDATA_API_TOKEN
  const datasetId = process.env.BRIGHTDATA_LINKEDIN_COMPANY_DATASET_ID
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
    if (!res.ok) return empty
    const data = await res.json()
    const p = Array.isArray(data) ? data[0] : data
    if (!p || p.error) return empty

    // Strip LinkedIn follower prefix from description e.g. "Microsoft | 28M followers on LinkedIn. ..."
    const rawDesc: string = p.description ?? ''
    const description = rawDesc.replace(/^[^|]+\|\s*[\d,.]+ followers on LinkedIn\.\s*/i, '').trim() || null

    // employee_count: prefer company_size string, fall back to formatting employees_in_linkedin number
    let employee_count: string | null = p.company_size ?? null
    if (!employee_count && p.employees_in_linkedin) {
      const n = Number(p.employees_in_linkedin)
      if (!isNaN(n)) employee_count = n >= 1000 ? `${(n / 1000).toFixed(0)}K+` : String(n)
    }

    return {
      name: p.name ?? null,
      description,
      employee_count,
      hq: p.headquarters ?? null,
      logo_url: p.logo ?? null,
      website_url: p.website ?? null,
    }
  } catch (e) {
    console.error('[company-profile] LinkedIn company scrape error:', e instanceof Error ? e.message : e)
    return empty
  }
}

async function findWebsiteForCompany(name: string): Promise<string | null> {
  // Brave Search API if key configured (free tier: 2000/month at api.search.brave.com)
  const braveKey = process.env.BRAVE_SEARCH_API_KEY
  if (braveKey) {
    try {
      const braveRes = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(`${name} official website`)}&count=5`,
        { signal: AbortSignal.timeout(8000), headers: { 'Accept': 'application/json', 'Accept-Encoding': 'gzip', 'X-Subscription-Token': braveKey } }
      )
      if (braveRes.ok) {
        const brave = await braveRes.json()
        for (const result of brave.web?.results ?? []) {
          const href: string = result.url
          if (href && !isSkipped(href)) {
            try {
              const { protocol, hostname } = new URL(href)
              if (['http:', 'https:'].includes(protocol)) return `${protocol}//${hostname}`
            } catch { continue }
          }
        }
      }
    } catch { /* fall through */ }
  }

  // Domain guess — works for simple well-known names (e.g. "Henry Schein" → henryschein.com)
  const guessed = name.toLowerCase().replace(/[^a-z0-9]+/g, '') + '.com'
  try {
    const res = await fetch(`https://${guessed}`, { method: 'HEAD', signal: AbortSignal.timeout(5000) })
    if (res.ok || res.status < 400) return `https://${guessed}`
  } catch { /* not reachable */ }

  return null
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
    await page.goto(websiteUrl, { waitUntil: 'networkidle', timeout: 25000 }).catch(() =>
      page.goto(websiteUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })
    )
    await page.waitForTimeout(1000)

    const logo_url = await page.evaluate((base: string) => {
      const og = document.querySelector('meta[property="og:image"]')?.getAttribute('content')
      if (og && !og.includes('placeholder') && !og.includes('default')) return og
      const apple = document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href')
      if (apple) { try { return new URL(apple, base).href } catch { return null } }
      return null
    }, websiteUrl)

    const homepageText = await page.evaluate(() => {
      const remove = ['nav', 'footer', 'header', 'script', 'style', 'noscript']
      remove.forEach((tag) => document.querySelectorAll(tag).forEach((el) => el.remove()))
      return document.body.innerText.slice(0, 4000).replace(/\s+/g, ' ').trim()
    })

    let aboutText = ''
    try {
      const aboutPage = await context.newPage()
      await aboutPage.goto(`${websiteUrl}/about`, { waitUntil: 'domcontentloaded', timeout: 10000 })
      aboutText = await aboutPage.evaluate(() => {
        const remove = ['nav', 'footer', 'header', 'script', 'style', 'noscript']
        remove.forEach((tag) => document.querySelectorAll(tag).forEach((el) => el.remove()))
        return document.body.innerText.slice(0, 3000).replace(/\s+/g, ' ').trim()
      })
      await aboutPage.close()
    } catch { /* /about not available */ }

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
    // Run Wikidata + LinkedIn company lookup in parallel
    const [wikidata, linkedInData] = await Promise.all([
      name ? lookupWikidata(name) : Promise.resolve({ website: null, revenue: null, employee_count: null, founded_year: null, hq: null }),
      name ? findLinkedInCompanyUrl(name).then((url) => url ? scrapeLinkedInCompany(url) : Promise.resolve({ name: null, description: null, employee_count: null, hq: null, logo_url: null, website_url: null })) : Promise.resolve({ name: null, description: null, employee_count: null, hq: null, logo_url: null, website_url: null }),
    ])

    if (!websiteUrl) websiteUrl = linkedInData.website_url || wikidata.website
    if (!websiteUrl) websiteUrl = await findWebsiteForCompany(name!)

    // If LinkedIn gave us enough data, we can skip scraping entirely
    const linkedInHasData = linkedInData.description || linkedInData.hq || linkedInData.employee_count
    if (!websiteUrl && !linkedInHasData) {
      return NextResponse.json({
        domain, name, description: null, industry: null, sic_code: null,
        sic_description: null,
        revenue: wikidata.revenue,
        employee_count: wikidata.employee_count,
        founded_year: wikidata.founded_year,
        hq: wikidata.hq,
        logo_url: null, website_url: null,
      })
    }

    let scraped: CompanyProfile | null = null
    if (websiteUrl) scraped = await scrapeCompany(websiteUrl, domain)

    // Merge priority: scraped > LinkedIn > Wikidata
    const profile: CompanyProfile = {
      domain,
      name: scraped?.name || linkedInData.name || name || null,
      description: scraped?.description || linkedInData.description || null,
      industry: scraped?.industry || null,
      sic_code: scraped?.sic_code || null,
      sic_description: scraped?.sic_description || null,
      revenue: scraped?.revenue || wikidata.revenue,
      employee_count: scraped?.employee_count || linkedInData.employee_count || wikidata.employee_count,
      founded_year: scraped?.founded_year || wikidata.founded_year,
      hq: scraped?.hq || linkedInData.hq || wikidata.hq,
      logo_url: scraped?.logo_url || linkedInData.logo_url || null,
      website_url: websiteUrl,
    }

    supabase.from('company_profiles').upsert({ ...profile, fetched_at: new Date().toISOString() })
      .then(({ error }) => { if (error) console.error('[company-profile] Cache write failed:', error.message) })

    return NextResponse.json(profile)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[company-profile] Error:', message)
    return NextResponse.json({
      domain, name: name ?? domain, description: null, industry: null,
      sic_code: null, sic_description: null, revenue: null, employee_count: null,
      founded_year: null, hq: null, logo_url: null, website_url: websiteUrl,
    })
  }
}
