import { setupDevPlatform } from '@cloudflare/next-on-pages/next-dev';

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.scdn.co',
      },
      {
        protocol: 'https',
        hostname: '**.spotifycdn.com',
      },
    ],
  },
};

if (process.env.NODE_ENV === 'development') {
  try {
    await setupDevPlatform();
  } catch (e) {
    console.warn('Failed to setup dev platform:', e);
  }
}

export default nextConfig;