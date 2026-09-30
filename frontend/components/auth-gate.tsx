"use client";

import { Github, LockKeyhole } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "./auth-provider";

export function safeReturnPath(value: string | null): string | null {
  return value && value.startsWith("/") && !value.startsWith("//")
    ? value
    : null;
}

export function AuthGate({
  children,
  title = "Sign in to open this workspace",
}: {
  children: React.ReactNode;
  title?: string;
}) {
  const auth = useAuth();
  if (auth.loading)
    return (
      <main className="centered-state">
        <span className="activity-dot" />
        <strong>Verifying your session…</strong>
      </main>
    );
  if (!auth.user) {
    if (typeof window !== "undefined") {
      const path = `${window.location.pathname}${window.location.search}`;
      if (safeReturnPath(path))
        window.sessionStorage.setItem("azync.return_path", path);
    }
    return (
      <main className="centered-state">
        <LockKeyhole size={28} />
        <strong>{title}</strong>
        <p>
          GitHub establishes your identity; the backend checks permissions for
          each hackathon and team.
        </p>
        <a className="button primary" href={api.auth.githubUrl}>
          <Github size={16} /> Continue with GitHub
        </a>
      </main>
    );
  }
  return children;
}
