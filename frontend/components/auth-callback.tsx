"use client";

import { CheckCircle2, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "./auth-provider";
import { startRouteTransition } from "@/lib/route-navigation";
import { safeReturnPath } from "./auth-gate";

export function AuthCallback() {
  const { setToken } = useAuth();
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get(
      "access_token",
    );
    window.history.replaceState(null, "", "/auth/callback");
    if (!token) {
      setFailed(true);
      return;
    }
    void setToken(token).then((ok) => {
      if (ok) {
        const returnPath =
          safeReturnPath(window.sessionStorage.getItem("azync.return_path")) ||
          "/dashboard";
        window.sessionStorage.removeItem("azync.return_path");
        startRouteTransition(returnPath);
        router.replace(returnPath);
      } else {
        setFailed(true);
      }
    });
  }, [setToken, router]);
  return (
    <main className="centered-state">
      {failed ? (
        <>
          <ShieldAlert size={28} />
          <strong>Could not complete sign-in</strong>
          <p>
            The OAuth callback did not contain a valid session. Try signing in
            with GitHub again.
          </p>
        </>
      ) : (
        <>
          <CheckCircle2 size={28} />
          <strong>Completing GitHub OAuth…</strong>
          <p>
            The token is transferred only in the URL fragment and immediately
            removed from the address bar.
          </p>
        </>
      )}
    </main>
  );
}
