import type { Metadata } from "next";
import StudioShell from "@/components/layout/StudioShell";
import "@fontsource/open-sans/400.css";
import "@fontsource/open-sans/600.css";
import "@fontsource/open-sans/700.css";
import "material-symbols/outlined.css";
import "./ks.css";

export const metadata: Metadata = {
  title: "Knowledge Studio",
  description: "Turn raw content into structured solutions",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body><StudioShell>{children}</StudioShell></body>
    </html>
  );
}
