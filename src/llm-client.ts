import OpenAI from "openai";
import type { CardData, Rarity, Color } from "mtg-crucible";
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

const ART_DIRECTIVE_ENUM = ["generate", "keep_self", "keep_other", "edit_self", "edit_other"] as const;
export type ArtDirective = typeof ART_DIRECTIVE_ENUM[number];

const CARD_SCHEMA: OpenAI.FunctionParameters = {
  type: "object",
  additionalProperties: false,
  required: [
    "name", "manaCost", "typeLine", "abilities", "flavorText", "artDescription",
    "artDirective", "rarity", "colorIndicator", "power", "toughness",
    "startingLoyalty", "battleDefense",
  ],
  properties: {
    name: { type: "string", description: "Card name" },
    manaCost: { type: "string", description: "Mana cost like {1}{W}{U}. Empty string for lands and transform back faces." },
    typeLine: { type: "string", description: "Full type line, e.g. 'Legendary Creature — Human Wizard', 'Enchantment — Saga', 'Battle — Siege'." },
    abilities: { type: "string", description: "Rules text, one ability per line. Planeswalkers: '+N: text'. Sagas: 'I — text'. Empty string for vanilla creatures." },
    flavorText: { type: "string", description: "Flavor text. Empty string if abilities are already rich/long." },
    artDescription: { type: "string", description: "Vivid description of the card art. When artDirective is edit_self/edit_other, describe only the DELTA." },
    artDirective: {
      type: "string",
      enum: ART_DIRECTIVE_ENUM as unknown as string[],
      description: "How to produce this face's art: generate (new art from scratch), keep_self (use this face's existing art unchanged), keep_other (use other face's existing art unchanged — swap case), edit_self (Kontext tweak of own art), edit_other (Kontext tweak of other face's art).",
    },
    rarity: { type: "string", enum: ["common", "uncommon", "rare", "mythic"] },
    colorIndicator: { type: "string", description: "Color letters like 'G' or 'UB' for cards with no manaCost that need a color identity (transform back faces, aftermath back halves). Empty string otherwise." },
    power: { type: "string", description: "Power. Empty string for non-creatures." },
    toughness: { type: "string", description: "Toughness. Empty string for non-creatures." },
    startingLoyalty: { type: "string", description: "Starting loyalty, usually '3'-'5'. Empty string for non-planeswalkers." },
    battleDefense: { type: "string", description: "Defense value, usually '3'-'5'. Empty string for non-battles." },
  },
};

const DESIGN_CARD_TOOL: OpenAI.ChatCompletionTool = {
  type: "function",
  function: {
    name: "design_card",
    description: "Design a Magic: The Gathering card. Use one card for single-faced designs, two for transform/adventure/split/modal-DFC/aftermath.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["cards"],
      properties: {
        cards: {
          type: "array",
          description: "One card for single-faced. Two cards for multi-face (transform, adventure, split, modal DFC, aftermath, flip, fuse). The framework infers layout from card content.",
          minItems: 1,
          maxItems: 2,
          items: CARD_SCHEMA,
        },
      },
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
  manaCost: string;
  typeLine: string;
  abilities: string;
  flavorText: string;
  artDescription: string;
  artDirective: ArtDirective;
  rarity: string;
  colorIndicator: string;
  power: string;
  toughness: string;
  startingLoyalty: string;
  battleDefense: string;
}

const blank = (s: string | undefined): string | undefined => (s && s !== "") ? s : undefined;

function llmCardToCardData(card: LLMCard, linkedCard?: LLMCard): CardData {
  return {
    name: card.name,
    manaCost: blank(card.manaCost),
    typeLine: card.typeLine,
    rarity: card.rarity as Rarity,
    abilities: blank(card.abilities),
    flavorText: blank(card.flavorText),
    artDescription: card.artDescription,
    colorIndicator: parseColorIndicator(blank(card.colorIndicator)),
    power: blank(card.power),
    toughness: blank(card.toughness),
    startingLoyalty: blank(card.startingLoyalty),
    battleDefense: blank(card.battleDefense),
    linkedCard: linkedCard ? llmCardToCardData(linkedCard) : undefined,
  };
}

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

export const SYSTEM_PROMPTS = {
  v6_minimal: `You are a Magic: The Gathering card designer. Call the design_card tool with a \`cards\` array.

## Shape
- \`cards\` has 1 item for single-faced cards, 2 items for multi-face (transform, adventure, split, modal DFC, aftermath, flip, fuse). The framework infers layout from the card content — do NOT pick a "linkType".
- Every field on every card must be present. For fields that don't apply, use "" (empty string):
  - Lands and transform back faces: \`manaCost: ""\`
  - Non-creatures: \`power: ""\`, \`toughness: ""\`
  - Non-planeswalkers: \`startingLoyalty: ""\`
  - Non-battles: \`battleDefense: ""\`
  - Cards that don't need a color identity beyond manaCost: \`colorIndicator: ""\`
  - Vanilla creatures with no rules text: \`abilities: ""\`
- Each face has its OWN name. Do NOT put "Wine // Dine" in a single card's name — use two cards, one named "Wine", one named "Dine".
- If the abilities text is already rich or long, set \`flavorText: ""\` to keep the card readable. Only write flavor text when the rules text is short and the flavor genuinely adds something.

## artDirective (required per face)
- "generate" — generate new art from scratch. Default for new cards.
- "keep_self" — use this face's existing art unchanged. Edit-mode only.
- "keep_other" — use the OTHER face's existing art unchanged (art-swap case). Edit-mode only.
- "edit_self" — Flux Kontext tweak of this face's existing art. Put ONLY the delta in artDescription ("add dramatic storm clouds").
- "edit_other" — Flux Kontext tweak of the other face's art. In create mode, face 2 can derive from face 1's newly generated art this way. Delta only in artDescription.

When editing an existing card and the user didn't ask to change art, use "keep_self" on both faces.

## Color pie (strict)
- WHITE: lifegain, exile-based removal, tokens, protection, pacifism, rules-setting
- BLUE: draw, counter spells, bounce, flying, unblockable, tempo
- BLACK: unconditional destroy, TARGETED discard (opponent chooses from hand), life drain, sacrifice, reanimation
- RED: direct damage, haste, impulse draw (exile then play), RANDOM discard only, chaos, temporary theft
- GREEN: big creatures, ramp, trample, reach, fight, artifact/enchantment destruction

Common violations to avoid: targeted discard is BLACK only (red only gets random). Counter spells are BLUE only. Unconditional destroy is BLACK (white uses conditions or exile). Drawing cards unconditionally at instant speed is BLUE only.

## Rarity = complexity ceiling
- common: 1-2 keywords max, vanilla or French vanilla, no triggered card advantage.
- uncommon: one meaningful triggered or activated ability.
- rare: complex unique abilities are fine.
- mythic: splashy, memorable, typically CMC 5+.

## Technical
- Mana: {W} {U} {B} {R} {G} {C}, generic like {1} {2}, {X}, hybrid {W/U}, Phyrexian {G/P}.
- typeLine is the FULL line: "Legendary Creature — Human Wizard", "Enchantment — Saga", "Battle — Siege", "Instant — Adventure".
- abilities: one per line. Planeswalkers: "+N: text" / "-N: text". Sagas: "I — text", "II — text".
- Transform back faces: manaCost="" and colorIndicator is set (e.g. "G", "UB").
- Adventure: main face is a creature; second card is Instant/Sorcery — Adventure.
- Battle — Siege: include battleDefense and a "When ~ is defeated, ..." ability.`,

};

const SYSTEM_PROMPT = SYSTEM_PROMPTS.v6_minimal;
const EDIT_SYSTEM_PROMPT = SYSTEM_PROMPT;

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
  const cards: LLMCard[] = args.cards;
  if (!cards?.length || !cards[0]?.name) throw new Error("Missing primary card in tool call");
  const [primary, secondary] = cards;
  const cardData = llmCardToCardData(primary, secondary);

  // Expose per-face directives to downstream via the existing art_directives shape.
  // The downstream pipeline still reads the old FaceArtDirective schema; we cast here
  // to keep the interface stable until the card-generator is updated in a follow-up.
  const artDirectives = primary.artDirective
    ? {
        primary: { mode: primary.artDirective as any },
        ...(secondary?.artDirective ? { secondary: { mode: secondary.artDirective as any } } : {}),
      }
    : undefined;

  return {
    cardData,
    explanation: "",
    art_directives: artDirectives as ArtDirectives | undefined,
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
