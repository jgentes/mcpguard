import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Enable static export for GitHub Pages
  output: 'export',
  images: {
    unoptimized: true,
  },
  // Trailing slash for static hosting compatibility
  trailingSlash: true,
};

export default withMDX(config);



