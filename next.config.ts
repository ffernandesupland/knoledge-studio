import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native module; must not be bundled.
  // pdf-parse/pdfjs-dist load their worker via a runtime-computed dynamic import path, which
  // Turbopack/webpack cannot resolve when bundled — excluding them keeps that path intact.
  serverExternalPackages: ["@libsql/client", "pdf-parse", "pdfjs-dist"],
  // PDF.js loads canvas via process.getBuiltinModule(...).createRequire and the
  // worker via a computed URL. Neither is discovered by automatic file tracing.
  outputFileTracingIncludes: {
    "/api/ingest": [
      "./node_modules/@napi-rs/canvas*/**/*",
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    ],
  },
};

export default nextConfig;
