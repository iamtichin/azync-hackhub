"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ROUTE_TRANSITION_EVENT } from "@/lib/route-navigation";
import { RouteLoader } from "./route-loader";

const SAFETY_TIMEOUT_MS = 12_000;

export function RouteTransitionIndicator() {
  const pathname = usePathname();
  const [pending, setPending] = useState(false);
  const originPathnameRef = useRef(pathname);
  const currentPathnameRef = useRef(pathname);
  const safetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
    safetyTimerRef.current = null;
    setPending(false);
  }, []);

  const beginFrom = useCallback(
    (fromPathname: string) => {
      if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
      originPathnameRef.current = fromPathname;
      setPending(true);
      safetyTimerRef.current = setTimeout(clear, SAFETY_TIMEOUT_MS);
    },
    [clear],
  );

  const begin = useCallback(() => {
    beginFrom(window.location.pathname);
  }, [beginFrom]);

  useEffect(() => {
    function beginFromLink(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target;
      const anchor =
        target instanceof Element
          ? target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (
        !anchor ||
        anchor.download ||
        (anchor.target && anchor.target !== "_self")
      ) {
        return;
      }

      const destination = new URL(anchor.href, window.location.href);
      if (
        destination.origin !== window.location.origin ||
        destination.pathname === window.location.pathname
      ) {
        return;
      }

      begin();
    }

    document.addEventListener("click", beginFromLink, true);
    const beginFromHistory = () => beginFrom(currentPathnameRef.current);

    window.addEventListener("popstate", beginFromHistory);
    window.addEventListener(ROUTE_TRANSITION_EVENT, begin);
    return () => {
      document.removeEventListener("click", beginFromLink, true);
      window.removeEventListener("popstate", beginFromHistory);
      window.removeEventListener(ROUTE_TRANSITION_EVENT, begin);
      if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
    };
  }, [begin, beginFrom]);

  useEffect(() => {
    if (pending && pathname !== originPathnameRef.current) clear();
    currentPathnameRef.current = pathname;
  }, [clear, pathname, pending]);

  if (!pending) return null;

  return (
    <div className="route-transition-layer" aria-busy="true">
      <RouteLoader />
    </div>
  );
}
