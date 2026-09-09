"use client";
import { signOut } from "next-auth/react";
export function SignOutButton() {
  return <button className="ds-btn ds-btn-secondary" type="button" onClick={() => signOut({ redirectTo: "/login" })}>Sign out</button>;
}
