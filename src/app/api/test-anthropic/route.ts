import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function GET() {
  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 64,
      messages: [{ role: 'user', content: 'Say "API works" and nothing else.' }],
    })
    const text = msg.content[0].type === 'text' ? msg.content[0].text : '(no text)'
    return NextResponse.json({ ok: true, response: text })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
