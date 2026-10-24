import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";

// Configure only the selected deployment; keep keys out of files, arguments, and logs.
const cli = "node_modules/convex/bin/main.js";
const deploymentArgs = process.argv.slice(2);
function run(args, input) {
  const result = spawnSync(process.execPath, [cli, "env", ...args, ...deploymentArgs], {
    input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.status !== 0) throw new Error("Convex auth setup failed. Start Convex and check the selected deployment.");
  return result.stdout.trim();
}

const privateExists = Boolean(run(["get", "JWT_PRIVATE_KEY"]));
const publicExists = Boolean(run(["get", "JWKS"]));
if (privateExists && publicExists) {
  console.log("Convex authentication keys already configured; kept the existing keys.");
} else if (privateExists || publicExists) {
  throw new Error("Only one authentication key is configured. Complete JWT_PRIVATE_KEY and JWKS in the Convex dashboard.");
} else {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const jwk = createPublicKey(privateKey).export({ format: "jwk" });
  run(["set", "JWT_PRIVATE_KEY"], privateKey.trimEnd().replace(/\n/g, " "));
  run(["set", "JWKS"], JSON.stringify({ keys: [{ use: "sig", ...jwk }] }));
  console.log("Configured Convex authentication keys for the selected deployment.");
}
