import { afterEach, expect, it, vi } from "vitest";
import { cafe } from "../scene/fixtures.js";
import { requestAgent } from "./agent.js";

afterEach(() => vi.unstubAllGlobals());
it.each([undefined, { token: "test", task: "coding", timeBucket: "morning" as const, turns: [] }])(
  "a cancelled command cannot replay an offline edit (%j)", async (context) => {
    vi.stubGlobal("fetch", vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
    })));
    const abort = new AbortController();
    const command = requestAgent("make it rainier", cafe, context, false, undefined, abort.signal);
    abort.abort();
    await expect(command).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);
it("cancels a managed voice run without reconnecting or loading its result", async () => {
  vi.stubGlobal("fetch", vi.fn((url, init) => url === "/api/agent"
    ? Promise.resolve(Response.json({ kind: "managed", token: "run-test" }))
    : new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
    })));
  const abort = new AbortController();
  const command = requestAgent("make this room cozier", cafe,
    { token: "test", task: "coding", timeBucket: "morning", turns: [] }, false, undefined, abort.signal);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  abort.abort();
  await expect(command).rejects.toMatchObject({ name: "AbortError" });
  expect(fetch).toHaveBeenCalledTimes(2);
});
it.each([undefined, { token: "test", task: "coding", timeBucket: "morning" as const, turns: [] }])(
  "cancels the Gemini fallback without applying an offline room (%j)", async (context) => {
    const fetchMock = vi.fn((_url, init) => JSON.parse(init.body).engine === "gemini"
      ? new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
      })
      : Promise.resolve(Response.json({ error: "Unavailable" }, { status: 503 })));
    vi.stubGlobal("fetch", fetchMock);
    const abort = new AbortController();
    const command = requestAgent("make it rainier", cafe, context, false, undefined, abort.signal);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    abort.abort();
    await expect(command).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  },
);
