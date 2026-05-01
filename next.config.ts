import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Playwright and Sharp must not be bundled by Next.js — they rely on native binaries
  serverExternalPackages: ['playwright', 'sharp'],
}

export default nextConfig
