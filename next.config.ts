import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'export',
  basePath: '/lanyard',
  images: {
    unoptimized: true,
  },
  // Playwright and Sharp must not be bundled by Next.js
  serverExternalPackages: ['playwright', 'sharp'],
}

export default nextConfig

