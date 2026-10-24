import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY?.trim();
if (!apiKey) {
  console.error("Set GEMINI_API_KEY in .env before running this check.");
  process.exitCode = 1;
} else {
  try {
    const client = new GoogleGenAI({ apiKey });
    const result = await client.interactions.create({
      model: "gemini-3.8-flash",
      input: "Reply with exactly: Gemini connected",
      store: false,
      generation_config: { thinking_level: "low", max_output_tokens: 64 },
    }, {
      timeout: 20_000,
      retries: {
        strategy: "attempt-count-backoff", maxRetries: 2, retryConnectionErrors: true,
        backoff: { initialInterval: 1000, exponent: 2, maxInterval: 4000 },
      },
      retry_codes: ["408", "429", "500", "502", "503", "504"],
    });
    if (result.output_text?.trim() !== "Gemini connected") {
      throw new Error("Unexpected response");
    }
    console.log("Gemini connected");
  } catch (error) {
    // Report status only; provider error messages can include request details.
    if (error.status === 408 || error.status === 504 || error.name.includes("Timeout")) {
      console.error("Gemini timed out after retrying. Try again shortly.");
    } else {
      console.error(`Gemini connection failed (HTTP ${error.status ?? "connection error"}) after retrying temporary errors. Check AI Studio access/quota, or retry if the model is busy.`);
    }
    process.exitCode = 1;
  }
}
