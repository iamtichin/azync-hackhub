"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { ChevronRight, Github, LogOut, ShieldCheck } from "lucide-react";
import { API_URL, api } from "@/lib/api";
import { useAuth } from "./auth-provider";

const navigation = [
  { href: "/", label: "Hackathons" },
  { href: "/dashboard", label: "Overview", requiresAuth: true },
  { href: "/teams", label: "Team", requiresAuth: true },
  { href: "/organizer", label: "Organizer", requiresAuth: true },
  { href: "/submissions", label: "Submissions", requiresAuth: true },
  { href: "/judge", label: "Judge workspace" },
  { href: "/submit", label: "Submit project" },
];

export function AppHeader() {
  const pathname = usePathname();
  const auth = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const authZoneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!authOpen) return;

    function closeOnOutsidePress(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !authZoneRef.current?.contains(event.target)
      ) {
        setAuthOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setAuthOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [authOpen]);

  async function submitToken(event: FormEvent) {
    event.preventDefault();
    if (!token.trim()) return;
    setSubmitting(true);
    const ok = await auth.setToken(token);
    setSubmitting(false);
    if (ok) {
      setToken("");
      setAuthOpen(false);
    }
  }

  return (
    <header className="topbar">
      <Link className="brand" href="/">
        <span className="brand-mark" aria-hidden="true">
          A
        </span>
        <span>
          <strong>Azync</strong>
          <small>HackHub</small>
        </span>
      </Link>
      <nav className="primary-nav" aria-label="Primary navigation">
        {navigation
          .filter((item) => !item.requiresAuth || auth.user)
          .map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={
                pathname === item.href ||
                (item.href !== "/" && pathname.startsWith(`${item.href}/`))
                  ? "active"
                  : undefined
              }
            >
              {item.label}
            </Link>
          ))}
      </nav>
      <div className="auth-zone" ref={authZoneRef}>
        <button
          className="identity-button"
          type="button"
          aria-label={
            auth.user
              ? `Account ${auth.user.name || auth.user.githubUsername}`
              : "Sign in"
          }
          aria-expanded={authOpen}
          onClick={() => setAuthOpen(!authOpen)}
        >
          <span
            className={`presence ${auth.user ? "online" : ""}`}
            aria-hidden="true"
          />
          <span className="identity-label">
            {auth.loading
              ? "Checking session"
              : auth.user?.name || auth.user?.githubUsername || "Sign in"}
          </span>
          <ChevronRight size={15} aria-hidden="true" />
        </button>
        {authOpen && (
          <div className="auth-popover">
            {auth.user ? (
              <>
                <p className="eyebrow">Judge session</p>
                <strong>{auth.user.name || auth.user.githubUsername}</strong>
                <p className="muted">@{auth.user.githubUsername}</p>
                <p className="microcopy">User ID: {auth.user.id}</p>
                <button
                  className="button secondary full"
                  type="button"
                  onClick={() => {
                    const university = prompt(
                      "University",
                      auth.user?.university || "",
                    );
                    const skills = prompt(
                      "Skills (comma separated)",
                      auth.user?.skills?.join(", ") || "",
                    );
                    if (university !== null && skills !== null)
                      void api.users.updateMe({
                        university,
                        skills: skills
                          .split(",")
                          .map((item) => item.trim())
                          .filter(Boolean),
                      });
                  }}
                >
                  University and skills profile
                </button>
                <button
                  className="button secondary full"
                  type="button"
                  onClick={auth.logout}
                >
                  <LogOut size={16} /> Sign out on this device
                </button>
              </>
            ) : (
              <>
                <p className="eyebrow">Backend authentication</p>
                <a className="button primary full" href={api.auth.githubUrl}>
                  <Github size={16} /> Continue with GitHub
                </a>
                <div className="auth-divider">
                  <span>local session</span>
                </div>
                <form onSubmit={submitToken}>
                  <label htmlFor="access-token">
                    JWT from the OAuth callback
                  </label>
                  <textarea
                    id="access-token"
                    rows={3}
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    placeholder="Stored only in this tab's sessionStorage"
                  />
                  <button
                    className="button secondary full"
                    disabled={submitting || !token.trim()}
                  >
                    <ShieldCheck size={16} />{" "}
                    {submitting ? "Verifying…" : "Use this session"}
                  </button>
                </form>
                {auth.error && (
                  <p className="form-error" role="alert">
                    {auth.error}
                  </p>
                )}
                <p className="microcopy">Backend: {API_URL}</p>
              </>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
