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

// ── Bright Data LinkedIn company ──────────────────────────────────────────────

// Generate plausible LinkedIn company slug variants from a company name
function linkedInSlugs(name: string): string[] {
  const suffixes = /\b(inc|llc|corp|ltd|co|company|group|holdings|international|global|services|solutions|technologies|technology)\b\.?/gi
  const clean = name.replace(suffixes, '').replace(/\s+/g, ' ').trim()
  const toSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return [...new Set([toSlug(name), toSlug(clean), name.toLowerCase().replace(/[^a-z0-9]/g, '')].filter(Boolean))]
}

async function scrapeLinkedInCompany(companyName: string) {
  const empty = { name: null, description: null, employee_count: null, hq: null, logo_url: null, website_url: null }
  const apiToken = process.env.BRIGHTDATA_API_TOKEN
  const datasetId = process.env.BRIGHTDATA_LINKEDIN_COMPANY_DATASET_ID
  if (!apiToken || !datasetId) return empty

  // Try slug guessing first — avoids DuckDuckGo search entirely
  const slugs = linkedInSlugs(companyName)
  const urls = slugs.map((s) => ({ url: `https://www.linkedin.com/company/${s}` }))

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
    if (!res.ok) {
      console.error('[company-profile] LinkedIn BD error:', res.status)
      return empty
    }
    const data = await res.json()
    const results = Array.isArray(data) ? data : [data]

    // Take first result that has a name (slug matched a real company)
    const p = results.find((r) => r && !r.error && r.name)
    if (!p) return empty

    const rawDesc: string = p.description ?? ''
    const description = rawDesc.replace(/^[^|]+\|\s*[\d,.]+ followers on LinkedIn\.\s*/i, '').trim() || null

    let employee_count: string | null = p.company_size ?? null
    if (!employee_count && p.employees_in_linkedin) {
      const n = Number(p.employees_in_linkedin)
      if (!isNaN(n)) employee_count = n >= 1000 ? `${(n / 1000).toFixed(0)}K+` : String(n)
    }

    return { name: p.name ?? null, description, employee_count, hq: p.headquarters ?? null, logo_url: p.logo ?? null, website_url: p.website ?? null }
  } catch (e) {
    console.error('[company-profile] LinkedIn scrape error:', e instanceof Error ? e.message : e)
    return empty
  }
}

// ── Search helpers (Serper = Google) ─────────────────────────────────────────

async function serperSearch(q: string): Promise<{ title: string; link: string }[]> {
  const key = process.env.SERPER_API_KEY
  if (!key) return []
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, num: 5 }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return []
    const data = await res.json()
    return data.organic ?? []
  } catch { return [] }
}

// ── Website URL discovery ─────────────────────────────────────────────────────

async function findWebsiteForCompany(name: string): Promise<string | null> {
  // Serper (Google) search
  const results = await serperSearch(`"${name}" official website`)
  for (const r of results) {
    if (r.link && !isSkipped(r.link)) {
      try { const { protocol, hostname } = new URL(r.link); return `${protocol}//${hostname}` } catch { continue }
    }
  }
  // Domain guess fallback
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
    // Find LinkedIn company URL via Serper, then scrape with Bright Data
    async function getLinkedInCompanyData(companyName: string) {
      // Try Serper search first
      const results = await serperSearch(`"${companyName}" site:linkedin.com/company`)
      for (const r of results) {
        const m = r.link?.match(/linkedin\.com\/company\/([a-zA-Z0-9\-_%]+)/)
        if (m) return scrapeLinkedInCompany(`https://www.linkedin.com/company/${m[1]}`)
      }
      // Fall back to slug guessing
      return scrapeLinkedInCompany(companyName)
    }

    const linkedInData = name
      ? await getLinkedInCompanyData(name)
      : { name: null, description: null, employee_count: null, hq: null, logo_url: null, website_url: null }

    if (!websiteUrl) websiteUrl = linkedInData.website_url
    if (!websiteUrl) websiteUrl = await findWebsiteForCompany(name!)

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
      revenue: null,
      employee_count: linkedInData.employee_count,
      founded_year: null,
      hq: linkedInData.hq,
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
