import { chromium } from 'playwright'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const maxDuration = 120

const EXECUTABLE_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

type CompanyProfile = {
  domain: string
  name: string | null
  description: string | null
  industry: string | null
  hq: string | null
  size: string | null
  logo_url: string | null
  website_url: string
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

async function scrapeCompany(websiteUrl: string, domain: string): Promise<CompanyProfile> {
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

    await page.goto(websiteUrl, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await page.waitForTimeout(1500)

    // Try to find logo from meta tags
    const logo_url = await page.evaluate(() => {
      const og = document.querySelector('meta[property="og:image"]')?.getAttribute('content')
      if (og && !og.includes('placeholder') && !og.includes('default')) return og
      const apple = document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href')
      if (apple) {
        try { return new URL(apple, location.href).href } catch { return null }
      }
      return null
    })

    const screenshot = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1280, height: 900 } })
    const base64 = screenshot.toString('base64')

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } },
            {
              type: 'text',
              text: `This is a screenshot of a company homepage (domain: ${domain}).
Extract the following and return as JSON only (no explanation):
- name: the company's official name
- description: 1-2 sentences about what the company does
- industry: the industry/sector (e.g. "Insurance", "Technology", "Financial Services")
- hq: headquarters city and country/state if visible, otherwise null
- size: employee count or company size if mentioned, otherwise null

Return JSON: {"name":"...","description":"...","industry":"...","hq":"...","size":"..."}`,
            },
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
      hq: parsed.hq ?? null,
      size: parsed.size ?? null,
      logo_url: logo_url ?? null,
      website_url: websiteUrl,
    }
  } finally {
    await browser.close().catch(() => {})
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const url = searchParams.get('url')?.trim()

  if (!url) return NextResponse.json({ error: 'url is required' }, { status: 400 })

  let parsedUrl: URL
  try { parsedUrl = new URL(url) } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
  }

  const domain = extractDomain(url)
  const websiteUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}`

  const supabase = getSupabase()

  // Check cache (valid for 30 days)
  const { data: cached } = await supabase
    .from('company_profiles')
    .select('*')
    .eq('domain', domain)
    .single()

  if (cached) {
    const ageMs = Date.now() - new Date(cached.fetched_at).getTime()
    if (ageMs < 30 * 24 * 60 * 60 * 1000) {
      return NextResponse.json(cached)
    }
  }

  try {
    const profile = await scrapeCompany(websiteUrl, domain)

    await supabase.from('company_profiles').upsert({
      ...profile,
      fetched_at: new Date().toISOString(),
    })

    return NextResponse.json(profile)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[company-profile] Error:', message)

    // Return partial data if scrape fails
    return NextResponse.json({
      domain,
      name: null,
      description: null,
      industry: null,
      hq: null,
      size: null,
      logo_url: null,
      website_url: websiteUrl,
      error: message,
    }, { status: 500 })
  }
}
