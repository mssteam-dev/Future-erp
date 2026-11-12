import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // كل الصفحات تقرأ بيانات حية من قاعدة البيانات
  cacheComponents: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
