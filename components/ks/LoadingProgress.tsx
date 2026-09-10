"use client";
import { useEffect, useState } from "react";

export function LoadingProgress({ label = "Starting your analysis…" }: { label?: string }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  return <div className="ks-loading">
    <span className="ks-spinner" aria-hidden="true" />
    <div><strong role="status">{label}</strong>
      <p>This may take a few minutes. Please hang tight — progress will appear here as each stage completes.</p>
      <span className="ks-loading-time">Elapsed: {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span>
    </div>
  </div>;
}
