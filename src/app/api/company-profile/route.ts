import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

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

async function classifyWithClaude(companyName: string): Promise<{ industry: string | null; sic_code: string | null; sic_description: string | null }> {
  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      messages: [{
        role: 'user',
        content: `Company: ${companyName}\n\nReturn JSON only:\n{"industry":"broad label e.g. Healthcare, Technology, Financial Services","sic_code":"4-digit SIC code","sic_description":"official SIC description"}\n\nSIC examples: 6311=Life Insurance,6021=State Commercial Banks,7372=Prepackaged Software,5047=Medical & Hospital Equipment,5122=Drugs Drug Proprietaries & Druggists,8000=Health Services,5511=New & Used Car Dealers,6531=Real Estate Dealers`,
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
    if (cached?.name) {
      const ageMs = Date.now() - new Date(cached.fetched_at).getTime()
      if (ageMs < 30 * 24 * 60 * 60 * 1000) return NextResponse.json(cached)
    }
  }

  try {
    const classification = await classifyWithClaude(name ?? domain)

    const profile: CompanyProfile = {
      domain,
      name: name || domain,
      description: null,
      industry: classification.industry,
      sic_code: classification.sic_code,
      sic_description: classification.sic_description,
      revenue: null,
      employee_count: null,
      founded_year: null,
      hq: null,
      logo_url: null,
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
