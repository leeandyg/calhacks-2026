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
