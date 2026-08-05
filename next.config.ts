import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {
    root: process.cwd(),
  },
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // 允许 IM 预览域名访问 /_next/* 资源（开发模式）
  allowedDevOrigins: ["*"],
};

export default nextConfig;
