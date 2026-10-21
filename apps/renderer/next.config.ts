import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // @ts-expect-error Next.js 16 agentRules configuration
  agentRules: false,
};

export default nextConfig;
