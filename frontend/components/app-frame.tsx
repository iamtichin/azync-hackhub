"use client";

import { usePathname } from "next/navigation";
import { AppHeader } from "./app-shell";
import { AzyncBot } from "./app-guide-chat";
import { useAuth } from "./auth-provider";
import { RouteTransitionIndicator } from "./route-transition";

export function AppFrame({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const pathname = usePathname();
  const sessionKey = `${auth.sessionVersion}:${auth.user?.id ?? "anonymous"}`;
  const routeSessionKey =
    pathname === "/auth/callback" ? "auth-callback" : sessionKey;

  return (
    <div className="app-frame">
      <AppHeader />
      <div className="route-content">
        <SessionRoute key={routeSessionKey}>{children}</SessionRoute>
        <RouteTransitionIndicator />
      </div>
      <AzyncBot key={sessionKey} />
    </div>
  );
}

function SessionRoute({ children }: { children: React.ReactNode }) {
  return children;
}
