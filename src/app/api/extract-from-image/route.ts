import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'

export const maxDuration = 60

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

type Attendee = {
  id: string
  name: string
  title: string | null
  company: string | null
  company_url: string | null
  location: string | null
  tags: string[]
  avatar_url: string | null
}

export async function POST(request: Request) {
  const formData = await request.formData()
  const files = formData.getAll('images') as File[]

  if (!files.length) {
    return NextResponse.json({ error: 'No images provided' }, { status: 400 })
  }

  const allAttendees: Attendee[] = []

  for (const file of files) {
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ error: `Unsupported file type: ${file.type}` }, { status: 400 })
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: `File too large: ${file.name} (max 10 MB)` }, { status: 400 })
    }

    const buffer = await file.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    const mediaType = file.type as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

    try {
      const message = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: base64 },
              },
              {
                type: 'text',
                text: `Extract all attendee/person information visible in this screenshot.
For each person return a JSON array with objects containing:
- name (full name)
- title (job title, role, or description — combine if multiple lines)
- company (organization or employer)
- company_url (company website URL if visible, e.g. "https://acme.com", otherwise null)
- location (city/state if visible)
- tags (any badge labels like "Speakers", "Sponsors", "Whova Loyal" etc.)

Return ONLY a valid JSON array, no explanation. Example:
[{"name":"Jane Smith","title":"CTO","company":"Acme Corp","company_url":"https://acme.com","location":"Austin, TX","tags":["Speakers"]}]

If a field is not visible, use null. Extract every person visible.`,
              },
            ],
          },
        ],
      })

      const text = message.content[0].type === 'text' ? message.content[0].text : ''
      const jsonMatch = text.match(/\[[\s\S]*\]/)
      if (!jsonMatch) continue

      const parsed = JSON.parse(jsonMatch[0]) as Omit<Attendee, 'id' | 'avatar_url'>[]
      allAttendees.push(
        ...parsed.map((a) => ({
          ...a,
          id: Math.random().toString(36).slice(2),
          avatar_url: null,
        })),
      )
    } catch (e) {
      console.error('[extract] Error processing image:', e instanceof Error ? e.message : e)
    }
  }

  if (allAttendees.length === 0) {
    return NextResponse.json({ error: 'Could not extract any attendees from the image(s).', attendees: [] })
  }

  return NextResponse.json({ attendees: allAttendees })
}
