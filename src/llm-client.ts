import OpenAI from "openai";
import type { CardData, Rarity } from "mtg-crucible";
import type { LLMCardResponse } from "./types.js";

// ---------------------------------------------------------------------------
// Provider / client config
// ---------------------------------------------------------------------------

export interface LLMConfig {
  provider: "groq" | "cerebras";
  model: string;
  apiKey: string;
}

function makeClient(config: LLMConfig): OpenAI {
  const baseURL = config.provider === "cerebras"
    ? "https://api.cerebras.ai/v1"
    : "https://api.groq.com/openai/v1";
  return new OpenAI({ apiKey: config.apiKey, baseURL });
}

/** Build config from environment variables. */
export function configFromEnv(): LLMConfig {
  const provider = (process.env.LLM_PROVIDER || "groq").toLowerCase() as "groq" | "cerebras";
  if (provider === "cerebras") {
    return {
      provider,
      model: process.env.CEREBRAS_MODEL || "qwen-3-235b-a22b-instruct-2507",
      apiKey: process.env.CEREBRAS_API_KEY || "",
    };
  }
  return {
    provider,
    model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    apiKey: process.env.GROQ_API_KEY || "",
  };
}

let _cached: { client: OpenAI; model: string } | undefined;

function getDefaultClient(): { client: OpenAI; model: string } {
  if (_cached) return _cached;
  const config = configFromEnv();
  _cached = { client: makeClient(config), model: config.model };
  return _cached;
}

// ---------------------------------------------------------------------------
// Tool definition — MVP: single-face cards only
// ---------------------------------------------------------------------------

const DESIGN_CARD_TOOL: OpenAI.ChatCompletionTool = {
  type: "function",
  function: {
    name: "design_card",
    description: "Design a Magic: The Gathering card",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Card name" },
        manaCost: {
          type: "string",
          description: "Mana cost using {W},{U},{B},{R},{G},{C},{1},{2},{X} etc. Hybrid: {W/U}. Phyrexian: {G/P}. Lands have no mana cost.",
        },
        typeLine: {
          type: "string",
          description: "Full type line, e.g. 'Legendary Creature — Human Wizard', 'Enchantment — Saga', 'Instant'",
        },
        abilities: { type: "string", description: "Rules text. One ability per line. For planeswalkers: '+1: text' format. For sagas: 'I — text' format." },
        flavorText: { type: "string", description: "Flavor text (optional)" },
        artDescription: { type: "string", description: "Vivid description of the card art to generate" },
        rarity: { type: "string", enum: ["common", "uncommon", "rare", "mythic"] },
        power: { type: "string", description: "Power (creatures only)" },
        toughness: { type: "string", description: "Toughness (creatures only)" },
        startingLoyalty: { type: "string", description: "Starting loyalty (planeswalkers only)" },
        explanation: { type: "string", description: "Brief explanation of the design" },
      },
      required: ["name", "typeLine", "abilities", "artDescription", "rarity", "explanation"],
    },
  },
};

// Edit-mode tool includes art_edit_mode
const EDIT_CARD_TOOL: OpenAI.ChatCompletionTool = {
  type: "function",
  function: {
    name: "design_card",
    description: "Edit a Magic: The Gathering card based on user feedback",
    parameters: {
      type: "object",
      properties: {
        ...(DESIGN_CARD_TOOL.function.parameters as { properties: Record<string, unknown> }).properties,
        artEditMode: {
          type: "string",
          enum: ["keep", "edit", "regenerate"],
          description: "How to handle art. 'keep': reuse existing art unchanged. 'edit': make targeted edits to existing art (put ONLY the delta/changes in artDescription). 'regenerate': generate completely new art from scratch.",
        },
      },
      required: ["name", "typeLine", "abilities", "artDescription", "rarity", "explanation", "artEditMode"],
    },
  },
};

// ---------------------------------------------------------------------------
// Parse tool call result into CardData
// ---------------------------------------------------------------------------

// colorIndicator removed for MVP — edge case for single-face cards

// ---------------------------------------------------------------------------
// System prompt — minimal, like v2
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You design Magic: The Gathering cards. Use the design_card tool.

Rules:
- Mana symbols: {W} {U} {B} {R} {G} {C}, {1} {2} etc for generic, {X} for X. Hybrid: {W/U}. Phyrexian: {G/P}
- Lands have no manaCost
- typeLine: full type line like "Legendary Creature — Human Wizard" or "Instant"
- abilities: one ability per line. Planeswalkers: "+1: text" format. Sagas: "I — text" format.
- ALWAYS provide a vivid artDescription
- For creatures, include power and toughness
- For planeswalkers, include startingLoyalty`;

const EDIT_SYSTEM_PROMPT = `You design Magic: The Gathering cards interactively. If the user has feedback, only change what they specifically ask for.

Set artEditMode to control what happens with the art:
- "keep" — reuse the existing art as-is (default if art is not mentioned)
- "edit" — make targeted edits to the existing art. Put ONLY the changes/delta in artDescription.
- "regenerate" — generate completely new art from scratch. Provide a full new artDescription.

Rules:
- Mana symbols: {W} {U} {B} {R} {G} {C}, {1} {2} etc for generic, {X} for X
- Lands have no manaCost
- typeLine: full type line like "Legendary Creature — Human Wizard" or "Instant"
- abilities: one ability per line. Planeswalkers: "+1: text" format. Sagas: "I — text" format.
- For creatures, include power and toughness
- For planeswalkers, include startingLoyalty`;

// ---------------------------------------------------------------------------
// Build messages
// ---------------------------------------------------------------------------

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
      { role: "system", content: EDIT_SYSTEM_PROMPT },
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

// ---------------------------------------------------------------------------
// Core LLM call
// ---------------------------------------------------------------------------

export interface LLMCallResult {
  response: LLMCardResponse;
  rawArgs: Record<string, unknown>;
  latencyMs: number;
}

export async function callLLM(
  client: OpenAI,
  model: string,
  prompt: string,
  originalCardText?: string,
  mode: string = "create",
): Promise<LLMCallResult> {
  const messages = buildMessages(prompt, originalCardText, mode);
  const tool = mode === "edit" ? EDIT_CARD_TOOL : DESIGN_CARD_TOOL;
  const start = Date.now();

  const response = await client.chat.completions.create({
    model,
    messages,
    tools: [tool],
    tool_choice: { type: "function", function: { name: "design_card" } },
  });

  const latencyMs = Date.now() - start;
  const toolCall = response.choices[0]?.message?.tool_calls?.[0];
  if (!toolCall || toolCall.function.name !== "design_card") {
    throw new Error("LLM did not call design_card tool");
  }

  const args = JSON.parse(toolCall.function.arguments);
  if (!args?.name) throw new Error("Missing card name in tool call");

  const cardData: CardData = {
    name: args.name,
    manaCost: args.manaCost || undefined,
    typeLine: args.typeLine,
    rarity: args.rarity as Rarity,
    abilities: args.abilities || undefined,
    flavorText: args.flavorText || undefined,
    artDescription: args.artDescription,
    power: args.power || undefined,
    toughness: args.toughness || undefined,
    startingLoyalty: args.startingLoyalty || undefined,
  };

  return {
    response: {
      cardData,
      explanation: args.explanation || "",
      artEditMode: args.artEditMode as "keep" | "edit" | "regenerate" | undefined,
    },
    rawArgs: args,
    latencyMs,
  };
}

// ---------------------------------------------------------------------------
// Server-facing export — uses env config, retries
// ---------------------------------------------------------------------------

export async function createCard(
  prompt: string,
  originalCardText?: string,
  mode: string = "create"
): Promise<LLMCardResponse> {
  const { client, model } = getDefaultClient();

  const MAX_RETRIES = 3;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      console.log(`[LLM] Attempt ${attempt + 1}/${MAX_RETRIES} with ${model}`);
      const result = await callLLM(client, model, prompt, originalCardText, mode);
      console.log(`[LLM] Response in ${(result.latencyMs / 1000).toFixed(2)}s`);
      console.log(`[LLM] Tool call args:\n${JSON.stringify(result.rawArgs, null, 2)}`);
      return result.response;
    } catch (err: any) {
      lastError = err;
      console.error(`[LLM] Attempt ${attempt + 1} failed:`, err.message);
    }
  }

  throw new Error(`Failed after ${MAX_RETRIES} attempts: ${lastError?.message}`);
}
