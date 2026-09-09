import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native module; must not be bundled.
  // pdf-parse/pdfjs-dist load their worker via a runtime-computed dynamic import path, which
  // Turbopack/webpack cannot resolve when bundled — excluding them keeps that path intact.
  serverExternalPackages: ["@libsql/client", "pdf-parse", "pdfjs-dist"],
};

export default nextConfig;
