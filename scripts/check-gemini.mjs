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
    }, { timeout: 30_000, maxRetries: 0 });
    if (result.output_text?.trim() !== "Gemini connected") {
      throw new Error("Unexpected response");
    }
    console.log("Gemini connected");
  } catch (error) {
    // Report status only; provider error messages can include request details.
    console.error(`Gemini connection failed (HTTP ${error.status ?? "unavailable"}). Check AI Studio access/quota, or retry if the model is busy.`);
    process.exitCode = 1;
  }
}
