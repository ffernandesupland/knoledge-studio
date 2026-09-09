"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
export function LoginForm({ returnTo }: { returnTo: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <form onSubmit={async (event) => {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    const fields = new FormData(event.currentTarget);
    try {
      const result = await signIn("credentials", { username: fields.get("username"), password: fields.get("password"), redirect: false });
      if (!result?.ok || result.error) { setError("Unable to sign in. Check your username and password."); setBusy(false); return; }
      window.location.assign(returnTo);
    } catch { setError("Unable to sign in. Please try again."); setBusy(false); }
  }}>
    <label className="form-label" htmlFor="username">Username</label><input className="form-input" id="username" name="username" autoComplete="username" required maxLength={200} />
    <label className="form-label" htmlFor="password" style={{ marginTop: 16 }}>Password</label><input className="form-input" id="password" name="password" type="password" autoComplete="current-password" required maxLength={1024} />
    {error && <p role="alert">{error}</p>}
    <button className="ds-btn ds-btn-primary" type="submit" disabled={busy} style={{ width: "100%", marginTop: 24 }}>{busy ? "Signing in…" : "Sign in"}</button>
  </form>;
}
