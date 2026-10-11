import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server for the Lambda Web Adapter image (see Dockerfile).
  output: "standalone",
};

export default nextConfig;
