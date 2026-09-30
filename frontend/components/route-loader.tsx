export function RouteLoader() {
  return (
    <section className="route-loader" role="status" aria-live="polite">
      <span className="route-loader-mark" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <div>
        <strong>Switching workspace</strong>
        <p>Azync is preparing the next screen…</p>
      </div>
    </section>
  );
}
