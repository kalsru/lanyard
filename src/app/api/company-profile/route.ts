import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const maxDuration = 120

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

// ── Wikidata ──────────────────────────────────────────────────────────────────

async function lookupWikidata(name: string) {
  const empty = { website: null, revenue: null, employee_count: null, founded_year: null, hq: null }
  try {
    const searchRes = await fetch(
      `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&type=item&format=json&limit=3&origin=*`,
      { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Lanyard/1.0' } }
    )
    if (!searchRes.ok) return empty
    const { search = [] } = await searchRes.json()

    for (const entity of search) {
      const entityRes = await fetch(
        `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${entity.id}&props=claims|labels&languages=en&format=json&origin=*`,
        { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Lanyard/1.0' } }
      )
      if (!entityRes.ok) continue
      const wd = (await entityRes.json()).entities?.[entity.id]
      if (!wd) continue
      const c = wd.claims ?? {}

      const p856 = c.P856?.[0]?.mainsnak?.datavalue?.value
      let website: string | null = null
      if (p856 && !isSkipped(p856)) {
        try { const { protocol, hostname } = new URL(p856); if (['http:', 'https:'].includes(protocol)) website = `${protocol}//${hostname}` } catch { /* skip */ }
      }

      const rev = c.P2139?.[0]?.mainsnak?.datavalue?.value
      const revenue = rev?.amount ? formatMoney(rev.amount, rev.unit ?? '') : null

      const emp = c.P1128?.[0]?.mainsnak?.datavalue?.value
      const employee_count = emp?.amount ? formatEmployees(emp.amount) : null

      const inc = c.P571?.[0]?.mainsnak?.datavalue?.value
      const founded_year = inc?.time ? (inc.time.match(/\+(\d{4})/)?.[1] ?? null) : null

      let hq: string | null = null
      const hqId = c.P159?.[0]?.mainsnak?.datavalue?.value?.id
      if (hqId) {
        try {
          const hqRes = await fetch(
            `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${hqId}&props=labels&languages=en&format=json&origin=*`,
            { signal: AbortSignal.timeout(5000), headers: { 'User-Agent': 'Lanyard/1.0' } }
          )
          if (hqRes.ok) hq = (await hqRes.json()).entities?.[hqId]?.labels?.en?.value ?? null
        } catch { /* skip */ }
      }

      if (website || revenue || employee_count) return { website, revenue, employee_count, founded_year, hq }
    }
  } catch { /* fall through */ }
  return empty
}

// ── Bright Data LinkedIn company ──────────────────────────────────────────────

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
        const { hostname, pathname } = new URL(decodeURIComponent(m[1]))
        if (hostname.includes('linkedin.com') && pathname.startsWith('/company/'))
          return `https://www.linkedin.com${pathname.split('/').slice(0, 3).join('/')}`
      } catch { continue }
    }
    const direct = html.match(/https?:\/\/(?:www\.)?linkedin\.com\/company\/([a-zA-Z0-9\-_%]{2,80})(?:\/|"|'|&)/)
    if (direct) return `https://www.linkedin.com/company/${direct[1]}`
  } catch { /* fall through */ }
  return null
}

async function scrapeLinkedInCompany(linkedInUrl: string) {
  const empty = { name: null, description: null, employee_count: null, hq: null, logo_url: null, website_url: null }
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

    const rawDesc: string = p.description ?? ''
    const description = rawDesc.replace(/^[^|]+\|\s*[\d,.]+ followers on LinkedIn\.\s*/i, '').trim() || null

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
    console.error('[company-profile] LinkedIn scrape error:', e instanceof Error ? e.message : e)
    return empty
  }
}

// ── Website URL discovery (no browser) ───────────────────────────────────────

async function findWebsiteForCompany(name: string): Promise<string | null> {
  const braveKey = process.env.BRAVE_SEARCH_API_KEY
  if (braveKey) {
    try {
      const res = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(`${name} official website`)}&count=5`,
        { signal: AbortSignal.timeout(8000), headers: { 'Accept': 'application/json', 'Accept-Encoding': 'gzip', 'X-Subscription-Token': braveKey } }
      )
      if (res.ok) {
        const data = await res.json()
        for (const result of data.web?.results ?? []) {
          if (result.url && !isSkipped(result.url)) {
            try { const { protocol, hostname } = new URL(result.url); return `${protocol}//${hostname}` } catch { continue }
          }
        }
      }
    } catch { /* fall through */ }
  }
  const guessed = name.toLowerCase().replace(/[^a-z0-9]+/g, '') + '.com'
  try {
    const res = await fetch(`https://${guessed}`, { method: 'HEAD', signal: AbortSignal.timeout(5000) })
    if (res.ok || res.status < 400) return `https://${guessed}`
  } catch { /* not reachable */ }
  return null
}

// ── Claude: classify industry + SIC from text (no browser needed) ─────────────

async function classifyWithClaude(companyName: string, description: string): Promise<{ industry: string | null; sic_code: string | null; sic_description: string | null }> {
  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      messages: [{
        role: 'user',
        content: `Company: ${companyName}\nDescription: ${description}\n\nReturn JSON only:\n{"industry":"broad label e.g. Healthcare, Technology, Financial Services","sic_code":"4-digit SIC code","sic_description":"official SIC description"}\n\nSIC examples: 6311=Life Insurance,6021=State Commercial Banks,7372=Prepackaged Software,5047=Medical & Hospital Equipment,5122=Drugs Drug Proprietaries & Druggists,8000=Health Services,5511=New & Used Car Dealers,6531=Real Estate Dealers`,
      }],
    })
    const text = message.content[0].type === 'text' ? message.content[0].text : '{}'
    const match = text.match(/\{[\s\S]*\}/)
    const parsed = match ? JSON.parse(match[0]) : {}
    return {
      industry: parsed.industry ?? null,
      sic_code: parsed.sic_code ? String(parsed.sic_code) : null,
      sic_description: parsed.sic_description ?? null,
    }
  } catch { return { industry: null, sic_code: null, sic_description: null } }
}

// ── GET handler ───────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const urlParam = searchParams.get('url')?.trim() || null
  const name = searchParams.get('name')?.trim() || null
  const refresh = searchParams.get('refresh') === 'true'

  if (!urlParam && !name) return NextResponse.json({ error: 'url or name is required' }, { status: 400 })

  let websiteUrl: string | null = null
  if (urlParam) {
    try { const p = new URL(urlParam); websiteUrl = `${p.protocol}//${p.hostname}` }
    catch { return NextResponse.json({ error: 'Invalid URL' }, { status: 400 }) }
  }

  const domain = websiteUrl ? extractDomain(websiteUrl) : (name ?? '')
  const supabase = getSupabase()

  if (!refresh) {
    const { data: cached } = await supabase.from('company_profiles').select('*').eq('domain', domain).single()
    if (cached?.description) {
      const ageMs = Date.now() - new Date(cached.fetched_at).getTime()
      if (ageMs < 30 * 24 * 60 * 60 * 1000) return NextResponse.json(cached)
    }
  }

  try {
    // Run all lookups in parallel — no browser needed
    const [wikidata, linkedInData] = await Promise.all([
      name ? lookupWikidata(name) : Promise.resolve({ website: null, revenue: null, employee_count: null, founded_year: null, hq: null }),
      name
        ? findLinkedInCompanyUrl(name).then((url) => url ? scrapeLinkedInCompany(url) : { name: null, description: null, employee_count: null, hq: null, logo_url: null, website_url: null })
        : Promise.resolve({ name: null, description: null, employee_count: null, hq: null, logo_url: null, website_url: null }),
    ])

    if (!websiteUrl) websiteUrl = linkedInData.website_url || wikidata.website
    if (!websiteUrl) websiteUrl = await findWebsiteForCompany(name!)

    // Use LinkedIn description + name to classify industry/SIC via Claude (text only, no scraping)
    const description = linkedInData.description
    const classification = description
      ? await classifyWithClaude(linkedInData.name ?? name ?? domain, description)
      : { industry: null, sic_code: null, sic_description: null }

    const profile: CompanyProfile = {
      domain,
      name: linkedInData.name || name || null,
      description,
      industry: classification.industry,
      sic_code: classification.sic_code,
      sic_description: classification.sic_description,
      revenue: wikidata.revenue,
      employee_count: linkedInData.employee_count || wikidata.employee_count,
      founded_year: wikidata.founded_year,
      hq: linkedInData.hq || wikidata.hq,
      logo_url: linkedInData.logo_url,
      website_url: websiteUrl,
    }

    supabase.from('company_profiles').upsert({ ...profile, fetched_at: new Date().toISOString() })
      .then(({ error }) => { if (error) console.error('[company-profile] Cache write failed:', error.message) })

    return NextResponse.json(profile)
  } catch (err) {
    console.error('[company-profile] Error:', err instanceof Error ? err.message : err)
    return NextResponse.json({
      domain, name: name ?? domain, description: null, industry: null,
      sic_code: null, sic_description: null, revenue: null, employee_count: null,
      founded_year: null, hq: null, logo_url: null, website_url: websiteUrl,
    })
  }
}
