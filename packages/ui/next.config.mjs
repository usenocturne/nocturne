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
          hostname: 'i.scdn.co',
        },
        {
          protocol: 'https',
          hostname: 'mosaic.scdn.co',
        },
        {
          protocol: 'https',
          hostname: 'daylist.spotifycdn.com',
        },
        {
          protocol: 'https',
          hostname: 'seed-mix-image.spotifycdn.com',
        },
        {
          protocol: 'https',
          hostname: 'image-cdn-fa.spotifycdn.com',
        },
        {
          protocol: 'https',
          hostname: 'image-cdn-ak.spotifycdn.com',
        },
        {
          protocol: 'https',
          hostname: 'wrapped-images.spotifycdn.com',
        },
        {
          protocol: 'https',
          hostname: 'pickasso.spotifycdn.com',
        }
      ],
    },
  };
  
  export default nextConfig;