export const ROUTE_TRANSITION_EVENT = "azync:navigation-start";

export function startRouteTransition(destination: string) {
  if (typeof window === "undefined") return;

  const target = new URL(destination, window.location.href);
  if (
    target.origin !== window.location.origin ||
    target.pathname === window.location.pathname
  ) {
    return;
  }

  window.dispatchEvent(new Event(ROUTE_TRANSITION_EVENT));
}
