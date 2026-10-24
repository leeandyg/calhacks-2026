import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from "vite";

export default defineConfig(({ mode }) => {
  // Server-side code in api/ reads keys from process.env, same as on Vercel.
  // Only VITE_-prefixed variables ever reach the browser.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));
  return { plugins: [react(), apiRoutes()] };
});

/**
 * Serves api/<name>.ts at /api/<name> during `npm run dev`, using the same
 * `export function POST(request: Request): Response` signature Vercel runs in production.
 */
function apiRoutes(): Plugin {
  return {
    name: "api-routes",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.match(/^\/api\/([\w-]+)/)?.[1];
        if (!name) return next();
        handle(server, name, req, res).catch((err: Error) => {
          server.ssrFixStacktrace(err);
          next(err);
        });
      });
    },
  };
}

async function handle(server: ViteDevServer, name: string, req: IncomingMessage, res: ServerResponse) {
  const mod = await server.ssrLoadModule(`/api/${name}.ts`);
  const method = req.method ?? "GET";
  const handler = mod[method] as ((request: Request) => Promise<Response>) | undefined;
  if (!handler) {
    res.statusCode = 405;
    res.end();
    return;
  }

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(key, value);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const request = new Request(new URL(req.url!, "http://localhost"), {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : Buffer.concat(chunks),
  });

  const response = await handler(request);
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  // Stream the body so server-sent events work once the agent streams (#18).
  if (response.body) for await (const chunk of response.body) res.write(chunk);
  res.end();
}
