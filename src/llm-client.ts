import OpenAI from "openai";
import type { LLMCardResponse } from "./types.js";

let _cached: { client: OpenAI; model: string } | undefined;

function getClient(): { client: OpenAI; model: string } {
  if (_cached) return _cached;
  
  const provider = (process.env.LLM_PROVIDER || "groq").toLowerCase();
  if (provider === "cerebras") {
    _cached = {
      client: new OpenAI({
        apiKey: process.env.CEREBRAS_API_KEY,
        baseURL: "https://api.cerebras.ai/v1",
      }),
      model: process.env.CEREBRAS_MODEL || "llama-3.3-70b",
    };
  } else {
    _cached = {
      client: new OpenAI({
        apiKey: process.env.GROQ_API_KEY,
        baseURL: "https://api.groq.com/openai/v1",
      }),
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    };
  }
  return _cached;
}

const SYSTEM_PROMPT = `You design Magic: The Gathering cards. You output card designs in a text spoiler format.

OUTPUT FORMAT — respond with a JSON object containing these fields:
- card_text (string, required): The card in the text format described below
- explanation (string, required): Brief explanation of how the card fulfills the request
- suggestion_artwork (string, required): A short, specific suggestion for a fine-grained art edit
- suggestion_mechanics (string, required): A short, specific suggestion for a gameplay/mechanics change
- art_edit_mode (string, optional): For edit mode only — "keep", "edit", or "regenerate"

TEXT FORMAT for card_text:

Line 1: Card Name {Mana Cost}
  Example: Lightning Bolt {R}
  Mana symbols: {W} {U} {B} {R} {G} {C}, {1} {2} etc for generic, {X} for X
  Hybrid: {W/U}, Phyrexian: {G/P}
  Lands have no mana cost.

Then metadata lines (optional, one per line):
  Rarity: common | uncommon | rare | mythic
  Art Description: A vivid description of the card art to generate
  Flavor Text: The italic flavor text

Then the type line:
  Examples: Legendary Creature — Human Wizard
           Enchantment — Saga
           Instant

Then abilities/rules text (one ability per line):
  For Planeswalkers: +1: ability / -2: ability / -7: ultimate
  For Sagas: I — text / II — text / III — text

Then P/T on its own line for creatures: 3/4

IMPORTANT:
- ALWAYS include "Art Description:" with a vivid description
- ALWAYS include "Rarity:"
- For Planeswalkers, include "Loyalty: N" after the type line
- For Battles, include "Defense: N"
- Do NOT wrap card_text in backticks or code blocks`;

function buildMessages(
  prompt: string,
  originalCardText: string | undefined,
  mode: string
): OpenAI.Chat.ChatCompletionMessageParam[] {
  if (mode === "copy" && originalCardText) {
    return [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Here's an existing card:\n\n${originalCardText}\n\nCreate a variation based on this feedback (change the name and art too): ${prompt}`,
      },
    ];
  }
  if (mode === "edit" && originalCardText) {
    return [
      {
        role: "system",
        content:
          SYSTEM_PROMPT +
          `\n\nWhen editing, also include art_edit_mode in your JSON response:
- "keep" — keep the existing art unchanged (default if art is not mentioned)
- "edit" — make fine-tuned edits to the existing art. Put ONLY the delta/changes in Art Description.
- "regenerate" — generate completely new art from scratch`,
      },
      {
        role: "user",
        content: `Here's an existing card:\n\n${originalCardText}\n\nApply this feedback (only change what's specifically requested): ${prompt}`,
      },
    ];
  }
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `Create a Magic: The Gathering card: ${prompt}` },
  ];
}

export async function createCard(
  prompt: string,
  originalCardText?: string,
  mode: string = "create"
): Promise<LLMCardResponse> {
  const { client, model } = getClient();
  const messages = buildMessages(prompt, originalCardText, mode);

  const MAX_RETRIES = 3;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      console.log(`[LLM] Attempt ${attempt + 1}/${MAX_RETRIES} with ${model}`);
      const start = Date.now();

      const response = await client.chat.completions.create({
        model,
        messages,
        response_format: { type: "json_object" },
      });

      console.log(`[LLM] Response in ${((Date.now() - start) / 1000).toFixed(2)}s`);

      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error("Empty LLM response");

      const data = JSON.parse(content) as LLMCardResponse;
      if (!data.card_text) throw new Error("Missing card_text in response");
      if (!data.explanation) data.explanation = "";
      if (!data.suggestion_artwork) data.suggestion_artwork = "";
      if (!data.suggestion_mechanics) data.suggestion_mechanics = "";

      return data;
    } catch (err: any) {
      lastError = err;
      console.error(`[LLM] Attempt ${attempt + 1} failed:`, err.message);
    }
  }

  throw new Error(`Failed after ${MAX_RETRIES} attempts: ${lastError?.message}`);
}
