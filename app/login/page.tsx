import { LoginForm } from "@/components/auth/LoginForm";
import { loginConfigured, safeReturnPath } from "@/lib/auth/credentials";
export const dynamic = "force-dynamic";
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const query = await searchParams;
  return <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24 }}>
    <section style={{ background: "white", padding: 32, borderRadius: 8, width: "100%", maxWidth: 400, border: "1px solid #BFC6CE" }}>
      <h1 style={{ fontSize: 24, marginTop: 0 }}>Knowledge Studio</h1><p>Sign in to continue.</p>
      {loginConfigured() ? <LoginForm returnTo={safeReturnPath(query.next)} /> : <p role="alert">Sign-in is not configured. Set KS_AUTH_USERNAME, KS_AUTH_PASSWORD and AUTH_SECRET on the server.</p>}
    </section>
  </main>;
}
