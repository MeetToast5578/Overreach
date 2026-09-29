// Overreach's static site (SANDBOX.md F8): single-player and the sandbox need
// no game server (the client runs LocalServer), so the production build plus
// an index.html rendered once is a complete site for any static host.
//
//   npm run build-static     # build-prod, then this: writes static-site/
//
// The page is rendered like upstream's per-version static page (RenderHtml,
// perServer: false): it names no server.
import fs from "fs/promises";
import path from "path";
import { renderHtmlContent } from "../../src/server/RenderHtml";

const root = path.join(import.meta.dirname, "../..");
const build = path.join(root, "static");
const site = path.join(root, "static-site");

await fs.rm(site, { recursive: true, force: true });
await fs.cp(build, site, { recursive: true });
const html = (
  await renderHtmlContent(path.join(build, "index.html"), { perServer: false })
).replace(
  "<head>",
  "<head><script>window.OVERREACH_STATIC_SITE = true;</script>",
);
await fs.writeFile(path.join(site, "index.html"), html);
console.log(`wrote ${site}`);
