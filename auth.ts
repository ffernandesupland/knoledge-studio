import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { credentialVersion, verifyLogin } from "@/lib/auth/credentials";

export const { handlers, auth } = NextAuth({
  providers: [Credentials({
    credentials: { username: { label: "Username", type: "text" }, password: { label: "Password", type: "password" } },
    authorize: (credentials) => verifyLogin(credentials.username, credentials.password),
  })],
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    jwt({ token, user }) {
      if (user) token.credentialVersion = credentialVersion();
      if (token.credentialVersion !== credentialVersion()) return null;
      return token;
    },
    session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub;
      return session;
    },
  },
});
