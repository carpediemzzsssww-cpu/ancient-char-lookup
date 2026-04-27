import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  // 允许从 ccamc.org 加载图片到 iframe（直链方式即可，无需 Image 组件优化）
};

export default nextConfig;
