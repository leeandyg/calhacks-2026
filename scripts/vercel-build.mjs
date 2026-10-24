import { spawnSync } from "node:child_process";

// Vercel's build command (vercel.json). With CONVEX_DEPLOY_KEY (set for Production only), it deploys
// the Convex functions first and builds against that deployment's URL, so convex/ and the site never
// drift apart. Without it (previews, local) it's the plain build, using VITE_CONVEX_URL if set.
const [command, args] = process.env.CONVEX_DEPLOY_KEY
  ? ["npx", ["convex", "deploy", "--cmd", "npm run build", "--cmd-url-env-var-name", "VITE_CONVEX_URL"]]
  : ["npm", ["run", "build"]];
const { status } = spawnSync(command, args, { stdio: "inherit" });
process.exit(status ?? 1);
