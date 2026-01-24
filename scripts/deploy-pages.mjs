import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

const isCloudflarePagesBuild = Boolean(process.env.CF_PAGES);

// Cloudflare Pages automatically deploys the build output after the build step.
// Running `wrangler pages deploy` inside the Pages build environment requires API tokens
// and will fail unless explicitly configured. We skip it to make deployments reliable.
if (isCloudflarePagesBuild) {
  // Keep output explicit so build logs explain why deploy is skipped.
  console.log(
    "[deploy] Detected Cloudflare Pages build environment; skipping `wrangler pages deploy` (Pages deploys automatically).",
  );
  process.exit(0);
}

const outputDir =
  process.env.CLOUDFLARE_PAGES_OUTPUT_DIR ?? ".vercel/output/static";
const projectName = process.env.CLOUDFLARE_PAGES_PROJECT ?? "arthyx";

if (!existsSync(outputDir)) {
  console.error(`[deploy] Build output directory not found: ${outputDir}`);
  console.error(
    "[deploy] Run `npm run build` first (or set CLOUDFLARE_PAGES_OUTPUT_DIR).",
  );
  process.exit(1);
}

const cmd = `npx wrangler pages deploy ${outputDir} --project-name=${projectName}`;
console.log(`[deploy] ${cmd}`);
execSync(cmd, { stdio: "inherit" });
