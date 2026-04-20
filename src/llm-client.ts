import OpenAI from "openai";
import type { CardData, LinkType, Rarity, Color } from "mtg-crucible";
import type { LLMCardResponse, ArtDirectives } from "./types.js";

// ---------------------------------------------------------------------------
// Provider / client config
// ---------------------------------------------------------------------------

export interface LLMConfig {
  provider: "groq" | "cerebras" | "anthropic" | "friendli";
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
// Tool definition
// ---------------------------------------------------------------------------

const CARD_SCHEMA: OpenAI.FunctionParameters = {
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
    colorIndicator: {
      type: "string",
      description: "Color indicator as color letters, e.g. 'G' for green, 'UB' for blue-black. Only needed for cards with no mana cost that need a color identity (e.g. transform back faces).",
    },
    power: { type: "string", description: "Power (creatures only)" },
    toughness: { type: "string", description: "Toughness (creatures only)" },
    startingLoyalty: { type: "string", description: "Starting loyalty (planeswalkers only)" },
    battleDefense: { type: "string", description: "Defense value (battles only)" },
  },
  required: ["name", "typeLine", "abilities", "artDescription", "rarity"],
};

const DESIGN_CARD_TOOL: OpenAI.ChatCompletionTool = {
  type: "function",
  function: {
    name: "design_card",
    description: "Design a Magic: The Gathering card",
    parameters: {
      type: "object",
      properties: {
        card: CARD_SCHEMA,
        linkedCard: {
          ...CARD_SCHEMA,
          description: "Second face/half of the card (for transform, adventure, modal DFC, split, etc.)",
        },
        linkType: {
          type: "string",
          enum: ["transform", "modal_dfc", "adventure", "flip", "split", "fuse", "aftermath"],
          description: "Relationship between card and linkedCard. Only set if linkedCard is provided.",
        },
        explanation: { type: "string", description: "Brief explanation of the design" },
        suggestionArtwork: { type: "string", description: "A specific suggestion for an art edit" },
        suggestionMechanics: { type: "string", description: "A specific suggestion for a mechanics change" },
        artDirectives: {
          type: "object",
          description: "For edit mode only: per-face art generation instructions. reference defaults to primary_old if omitted.",
          properties: {
            primary: {
              type: "object",
              properties: {
                mode: { type: "string", enum: ["no_edit", "fine_grained_edit", "coarse_grained_edit"], description: "no_edit: use referenced art as-is. fine_grained_edit: edit referenced art with Flux Kontext (put ONLY the delta in artDescription). coarse_grained_edit: generate new art from scratch." },
                reference: { type: "string", enum: ["primary_old", "secondary_old", "primary_new", "secondary_new"], description: "Which art to use as source. _old = from original card, _new = from the newly generated face. Ignored for coarse_grained_edit. Invalid combos (circular deps, self-refs) fall back to coarse_grained_edit." },
              },
              required: ["mode"],
            },
            secondary: {
              type: "object",
              properties: {
                mode: { type: "string", enum: ["no_edit", "fine_grained_edit", "coarse_grained_edit"] },
                reference: { type: "string", enum: ["primary_old", "secondary_old", "primary_new", "secondary_new"] },
              },
              required: ["mode"],
            },
          },
          required: ["primary"],
        },
      },
      required: ["card", "explanation"],
    },
  },
};

// ---------------------------------------------------------------------------
// Parse tool call result into CardData
// ---------------------------------------------------------------------------

const COLOR_MAP: Record<string, Color> = {
  W: "white", U: "blue", B: "black", R: "red", G: "green",
  w: "white", u: "blue", b: "black", r: "red", g: "green",
};

function parseColorIndicator(ci: string | undefined): Color[] | undefined {
  if (!ci) return undefined;
  const colors = ci.split("").map((c) => COLOR_MAP[c]).filter(Boolean) as Color[];
  return colors.length ? colors : undefined;
}

interface LLMCard {
  name: string;
  manaCost?: string;
  typeLine: string;
  abilities: string;
  flavorText?: string;
  artDescription: string;
  rarity: string;
  colorIndicator?: string;
  power?: string;
  toughness?: string;
  startingLoyalty?: string;
  battleDefense?: string;
}

function llmCardToCardData(card: LLMCard, linkType?: string, linkedCard?: LLMCard): CardData {
  return {
    name: card.name,
    manaCost: card.manaCost || undefined,
    typeLine: card.typeLine,
    rarity: card.rarity as Rarity,
    abilities: card.abilities || undefined,
    flavorText: card.flavorText || undefined,
    artDescription: card.artDescription,
    colorIndicator: parseColorIndicator(card.colorIndicator),
    power: card.power || undefined,
    toughness: card.toughness || undefined,
    startingLoyalty: card.startingLoyalty || undefined,
    battleDefense: card.battleDefense || undefined,
    linkType: linkType as LinkType | undefined,
    linkedCard: linkedCard ? llmCardToCardData(linkedCard) : undefined,
  };
}

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

export const SYSTEM_PROMPTS = {
  concise: `You are a Magic: The Gathering card designer. Use the design_card tool to create cards.

Key rules:
- Mana symbols: {W} {U} {B} {R} {G} {C}, {1} {2} etc for generic, {X} for X. Hybrid: {W/U}. Phyrexian: {G/P}
- Lands have no manaCost
- typeLine should be a full type line like "Legendary Creature — Human Wizard" or "Instant"
- abilities: one ability per line. Planeswalkers use "+1: text" format. Sagas use "I — text" format.
- ALWAYS provide a vivid artDescription
- For creatures, include power and toughness
- For planeswalkers, include startingLoyalty
- For battles, include battleDefense
- Only use colorIndicator for cards that need a color identity but have no mana cost (e.g. transform back faces)
- Use linkedCard + linkType for double-faced cards, adventures, split cards, etc.`,

  detailed: `You are an expert Magic: The Gathering card designer with deep knowledge of MTG history, color pie philosophy, and game balance. Use the design_card tool to create cards.

Design philosophy:
- Every card should feel like it belongs in a real MTG set. Consider limited environment, constructed playability, and flavor.
- Respect the color pie strictly: white gets lifegain/exile/tokens/rules-setting; blue gets draw/counter/bounce/flying; black gets kill/drain/discard/recursion; red gets burn/haste/impulse/chaos; green gets big bodies/ramp/fight/trample.
- Balance mana cost against power level. A 2-mana 3/3 with upside needs a drawback. A 6-mana creature needs to win the game.
- Common cards should be simple (1-2 keywords). Uncommons can have one triggered/activated ability. Rares can be complex. Mythics should be splashy and memorable.

Technical rules:
- Mana symbols: {W} {U} {B} {R} {G} {C}, {1} {2} etc for generic, {X} for X. Hybrid: {W/U}. Phyrexian: {G/P}
- Lands have no manaCost
- typeLine: full type line like "Legendary Creature — Human Wizard", "Enchantment — Saga", "Instant"
- abilities: one ability per line. Planeswalkers: "+1: text" format. Sagas: "I — text" format.
- ALWAYS provide a vivid, specific artDescription that an AI image generator could use
- For creatures: include power and toughness
- For planeswalkers: include startingLoyalty (typically 3-6)
- For battles: include battleDefense
- colorIndicator: only for cards with no mana cost that need a color identity (e.g. transform back faces, aftermath back halves)
- Use linkedCard + linkType for double-faced cards, adventures, split cards, etc.
- Split card names use "X // Y" convention. Adventure names are usually a verb phrase.`,
};

const SYSTEM_PROMPT = SYSTEM_PROMPTS.concise;

const EDIT_SYSTEM_PROMPT = SYSTEM_PROMPT + `\n\nWhen editing, set artDirectives to control art for each face:
- Each face gets a directive with "mode" and optional "reference"
- Modes:
  - "no_edit" — use the referenced face's existing art as-is (default if art is not mentioned)
  - "fine_grained_edit" — make targeted edits to the referenced art. Put ONLY the delta/changes in artDescription.
  - "coarse_grained_edit" — generate completely new art from scratch
- References:
  - "primary_old" / "secondary_old" — art from the original card's faces (available immediately)
  - "primary_new" / "secondary_new" — art from the newly generated face (generates that face first, then uses it as input)
  - Defaults to "primary_old" if omitted.
- For single-face cards, only set primary. For multi-face, set both primary and secondary.`;

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

function parseArgs(args: any): LLMCallResult["response"] {
  const card: LLMCard = args.card;
  if (!card?.name) throw new Error("Missing card name in tool call");
  const cardData = llmCardToCardData(card, args.linkType, args.linkedCard);

  return {
    cardData,
    explanation: args.explanation || "",
    suggestion_artwork: args.suggestionArtwork || "",
    suggestion_mechanics: args.suggestionMechanics || "",
    art_directives: args.artDirectives as ArtDirectives | undefined,
  };
}

export async function callLLM(
  client: OpenAI,
  model: string,
  prompt: string,
  originalCardText?: string,
  mode: string = "create",
  systemPromptOverride?: string,
): Promise<LLMCallResult> {
  const messages = buildMessages(prompt, originalCardText, mode);
  if (systemPromptOverride && messages[0]?.role === "system") {
    messages[0] = { role: "system", content: systemPromptOverride };
  }
  const start = Date.now();

  const response = await client.chat.completions.create({
    model,
    messages,
    tools: [DESIGN_CARD_TOOL],
    tool_choice: { type: "function", function: { name: "design_card" } },
  });

  const latencyMs = Date.now() - start;
  const toolCall = response.choices[0]?.message?.tool_calls?.[0];
  if (!toolCall || toolCall.function.name !== "design_card") {
    throw new Error("LLM did not call design_card tool");
  }

  const args = JSON.parse(toolCall.function.arguments);
  return { response: parseArgs(args), rawArgs: args, latencyMs };
}

// ---------------------------------------------------------------------------
// Anthropic-native LLM call (for eval / direct Anthropic API usage)
// ---------------------------------------------------------------------------

export async function callLLMAnthropic(
  apiKey: string,
  model: string,
  prompt: string,
  originalCardText?: string,
  mode: string = "create",
  systemPromptOverride?: string,
): Promise<LLMCallResult> {
  const messages = buildMessages(prompt, originalCardText, mode);
  const systemContent = systemPromptOverride ?? (messages[0]?.role === "system" ? messages[0].content as string : SYSTEM_PROMPT);
  const userMessages = messages.filter(m => m.role !== "system");
  const fn = DESIGN_CARD_TOOL.function;

  const start = Date.now();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: systemContent,
      messages: userMessages.map(m => ({ role: m.role, content: m.content })),
      tools: [{
        name: fn.name,
        description: fn.description,
        input_schema: fn.parameters,
      }],
      tool_choice: { type: "tool", name: "design_card" },
    }),
  });

  const latencyMs = Date.now() - start;
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic ${res.status}: ${body}`);
  }

  const json = await res.json() as any;
  const toolBlock = json.content?.find((b: any) => b.type === "tool_use");
  if (!toolBlock || toolBlock.name !== "design_card") {
    throw new Error("Anthropic did not call design_card tool");
  }

  return { response: parseArgs(toolBlock.input), rawArgs: toolBlock.input, latencyMs };
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
