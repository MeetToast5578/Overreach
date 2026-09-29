// A static-site build (tools/overreach/static-site.ts) has no game server:
// single-player and the sandbox only. Its index.html sets this flag.
export function isStaticSite(): boolean {
  return (
    (globalThis as { OVERREACH_STATIC_SITE?: boolean })
      .OVERREACH_STATIC_SITE === true
  );
}
