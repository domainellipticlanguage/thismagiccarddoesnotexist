import OpenAI from "openai";
import { formatTypeLine, formatAbilities } from "mtg-crucible";
import type { CardData, Rarity, Color } from "mtg-crucible";
import type { LLMCardResponse, ArtDirective } from "./types.js";

// ---------------------------------------------------------------------------
// Provider / client config
// ---------------------------------------------------------------------------

export interface LLMConfig {
  provider: "groq" | "cerebras" | "anthropic" | "friendli" | "mercury";
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
    model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
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

const ART_DIRECTIVE_ENUM: ArtDirective[] = ["generate", "keep_self", "keep_other", "edit_self", "edit_other"];

const CARD_SCHEMA: OpenAI.FunctionParameters = {
  type: "object",
  additionalProperties: false,
  required: [
    "name", "manaCost", "typeLine", "abilities", "flavorText", "artDescription",
    "artDirective", "rarity", "colorIndicator", "power", "toughness",
    "startingLoyalty", "battleDefense",
  ],
  properties: {
    name: { type: "string" },
    manaCost: { type: "string" },
    typeLine: { type: "string" },
    abilities: { type: "string" },
    flavorText: { type: "string" },
    artDescription: { type: "string" },
    artDirective: { type: "string", enum: ART_DIRECTIVE_ENUM as unknown as string[] },
    rarity: { type: "string", enum: ["common", "uncommon", "rare", "mythic"] },
    colorIndicator: { type: "string" },
    power: { type: "string" },
    toughness: { type: "string" },
    startingLoyalty: { type: "string" },
    battleDefense: { type: "string" },
  },
};

const CARDS_SCHEMA: OpenAI.FunctionParameters = {
  type: "object",
  additionalProperties: false,
  required: ["cards"],
  properties: {
    cards: {
      type: "array",
      minItems: 1,
      maxItems: 2,
      items: CARD_SCHEMA,
    },
  },
};

// Groq path: response_format with strict json_schema. Constrained decoding on
// gpt-oss-120b guarantees schema adherence — no malformed tool calls to patch.
// (Groq docs: tool use does NOT support structured outputs, only response_format.
//  https://console.groq.com/docs/structured-outputs)
const DESIGN_CARD_RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "design_card",
    strict: true,
    schema: CARDS_SCHEMA,
  },
};

// Anthropic path: tools, since Anthropic enforces tool input_schema strictly.
const DESIGN_CARD_TOOL: OpenAI.ChatCompletionTool = {
  type: "function",
  function: {
    name: "design_card",
    description: "Design a Magic: The Gathering card.",
    strict: true,
    parameters: CARDS_SCHEMA,
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
const expandTilde = (s: string | undefined, name: string): string | undefined =>
  s ? s.replace(/~/g, name) : s;
// Models occasionally emit the literal two-character sequence "\n" inside abilities
// instead of an actual newline, which the renderer then draws as "\n" mid-line.
// Crucible doesn't normalize this, so we do it at the boundary.
const unescapeNewlines = (s: string | undefined): string | undefined =>
  s ? s.replace(/\\n/g, "\n") : s;

function llmCardToCardData(card: LLMCard, linkedCard?: LLMCard): CardData {
  return {
    name: card.name,
    manaCost: blank(card.manaCost),
    typeLine: card.typeLine,
    rarity: card.rarity as Rarity,
    abilities: expandTilde(unescapeNewlines(blank(card.abilities)), card.name),
    flavorText: unescapeNewlines(blank(card.flavorText)),
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

export const SYSTEM_PROMPT = `You are a Magic: The Gathering card designer. Output a JSON object with a \`cards\` array.

## Shape
- \`cards\` has 1 item for single-faced cards, 2 items for multi-face (transform, adventure, split, modal DFC, aftermath, flip, fuse, battle, room, omen, prepare, etc.).
- Every field on every card must be present. For fields that don't apply, use "" (empty string):
- Each face has its OWN name. Do NOT put "Wine // Dine" in a single card's name.
- To keep the card readable, only write flavor text when the rules text is short and the flavor genuinely adds something.
- The majority of the time, a card will be a simple, single-faced card.

## artDirective (required per face)
- "generate" — generate new art from scratch
- "keep_self" — use this face's existing art unchanged
- "keep_other" — use the OTHER face's existing art unchanged (art-swap case)
- "edit_self" — Edit this face's existing art. Put ONLY the delta in artDescription ("turn the sword into a spear").
- "edit_other" — Edit the other face's art. In create mode, face 2 can derive from face 1's newly generated art this way. Delta only in artDescription.

When editing an existing card and the user didn't ask to change art, use "keep_self" on both faces.

## Color pie
Make sure card effects fit within the color pie. Defer to the user though if they explicitly want a color pie break, even if the user might not realize it's a color pie break.

## Balance
Make sure the power of the effect is appropriate for the card's rarity and cost.

## Technical
- Use standard MTG symbols e.g. {W}{U}{B}{R}{G}, {C}, {S}, {1}, {2}, {X}, {T}, {E}, etc.
- typeLine is the FULL line: "Legendary Creature — Human Wizard".
- abilities: one ability per line, separated by real newline characters in the JSON string (not the literal characters backslash-n). Planeswalkers: "+N: text" / "-N: text". Sagas: "I — text", "II,IV — text".
- In abilities, refer to the card by its full name OR \`~\`
- Transform back faces: \`manaCost: ""\` and colorIndicator is set (e.g. "G", "UB").
- Battle — Siege is a 2-card structure. Card 1: typeLine "Battle — Siege", \`battleDefense\` set. The first ability line is reminder text "(As a Siege enters, choose an opponent to protect it. You and others can attack it. When it’s defeated, exile it, then cast it transformed.)". Card 2: the post-defeat permanent (creature, enchantment, etc.), \`manaCost: ""\`, colorIndicator set.

## New mechanic: Prepared
Prepared is a 2-card mechanic. Like Adventure, a permanent card has a paired instant or sorcery in \`cards[1]\`. The permanent becomes prepared (usually via a triggered ability on it), the attached spell can be cast as a copy, and the permanent becomes unprepared.

When writing an ability that sets the prepared state, include the reminder text inline, parenthesized, on the same line. Example:
\`Whenever you cast a creature spell, ~ becomes prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)\`
The parenthesized text must be copied verbatim.

Prepared is NOT a keyword or subtype. Don't write "prepared" as a flavor word for unrelated state changes — pick a different word (readied, focused, aimed). Only use the Prepared mechanic when you produce a 2-card structure with the spell half in \`cards[1]\`.

## New mechanic: Omen
Omen is a 2-card mechanic. Similar to Adventure, a permanent can have an instant or sorcery as a secondary card. (So far, Omen has only ever appeared when the permanent card is a dragon creature). Omen is a subtype of Instant or Sorcery. The Omen spell causes the whole card to get shuffled into the library.
Include the reminder text inline, parenthesized, on the same line as the Omen spell ability. Example: 
\`Gain 3 life. (Then shuffle this card into its owner's library.)\`

## New mechanic: Room
Room  is a 2-card mechanic, where each side gets its own name (suggesting some relationship) and its own mana cost. Example: "Bottomless Pool {U} // Locker Room {4}{U}"
Room is a subtype of Enchantment. How it works is: 
You may cast either half. That door unlocks on the battlefield. As a sorcery, you may pay the mana cost of a locked door to unlock it.
They usually have regular static abilities like normal enchantments, which are only active when the room is unlocked.
Additionally, they sometimes have triggered abilities like \`When you unlock this door, ...\`.
`;

// ---------------------------------------------------------------------------
// CardData → LLMCard JSON (for showing the LLM the current state of a card
// in the same shape it produces output)
// ---------------------------------------------------------------------------

const COLOR_TO_LETTER: Record<Color, string> = {
  white: "W", blue: "U", black: "B", red: "R", green: "G",
};

function formatColorIndicator(ci: Color[] | undefined): string {
  if (!ci?.length) return "";
  return ci.map((c) => COLOR_TO_LETTER[c]).join("");
}

function formatCardTypeLine(tl: CardData["typeLine"]): string {
  if (!tl) return "";
  return typeof tl === "string" ? tl : formatTypeLine(tl);
}

function formatCardAbilities(ab: CardData["abilities"]): string {
  if (!ab) return "";
  return typeof ab === "string" ? ab : formatAbilities(ab);
}

/** Convert one CardData face to the LLMCard shape (the tool-call output schema),
 *  minus `artDirective` — that's a directive for the next render, not state.
 *  Empty/absent fields are dropped: the strict tool schema rejects "" for rarity,
 *  and showing a back face with `"rarity": ""` made models echo that into output. */
function faceToLLMCard(cd: CardData): Partial<Omit<LLMCard, "artDirective">> {
  const out: Partial<Omit<LLMCard, "artDirective">> = {};
  const set = <K extends keyof Omit<LLMCard, "artDirective">>(k: K, v: string | undefined) => {
    if (v) out[k] = v as Omit<LLMCard, "artDirective">[K];
  };
  set("name", cd.name);
  set("manaCost", cd.manaCost);
  set("typeLine", formatCardTypeLine(cd.typeLine));
  set("abilities", formatCardAbilities(cd.abilities));
  set("flavorText", cd.flavorText);
  set("artDescription", cd.artDescription);
  set("rarity", cd.rarity);
  set("colorIndicator", formatColorIndicator(cd.colorIndicator));
  set("power", cd.power);
  set("toughness", cd.toughness);
  set("startingLoyalty", cd.startingLoyalty);
  set("battleDefense", cd.battleDefense);
  return out;
}

/** Serialize a CardData (with optional linked face) as the `cards` array the LLM emits. */
export function cardDataToLLMCardsJson(cd: CardData): string {
  const cards: Array<Partial<Omit<LLMCard, "artDirective">>> = [faceToLLMCard(cd)];
  if (cd.linkedCard) cards.push(faceToLLMCard(cd.linkedCard));
  return JSON.stringify({ cards }, null, 2);
}

// ---------------------------------------------------------------------------
// Build messages — single unified template, maximizes shared prefix across
// create/edit/copy so prompt caching can hit on the system + intent header.
// ---------------------------------------------------------------------------

const INTENT_BY_MODE: Record<string, string> = {
  create: "Generate a new Magic: The Gathering card.",
  edit: "Edit the card below. Only change what the user asks for; keep everything else the same.",
  // TODO maybe just remove this?
  copy: "Edit the card below. Only change what the user asks for; keep everything else the same.",
};

function buildMessages(
  prompt: string,
  originalCardData: CardData | undefined,
  mode: string,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const intent = INTENT_BY_MODE[mode] ?? INTENT_BY_MODE.create;
  const stateBlock = originalCardData
    ? `The current state of the card is:\n${cardDataToLLMCardsJson(originalCardData)}\n\n`
    : "";
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `${intent}\n\n${stateBlock}The user wants: ${prompt}`,
    },
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

  const artDirectives: ArtDirective[] = [primary.artDirective];
  if (secondary?.artDirective) artDirectives.push(secondary.artDirective);

  return { cardData, artDirectives };
}

export async function callLLM(
  client: OpenAI,
  model: string,
  prompt: string,
  originalCardData?: CardData,
  mode: string = "create",
  systemPromptOverride?: string,
): Promise<LLMCallResult> {
  const messages = buildMessages(prompt, originalCardData, mode);
  if (systemPromptOverride && messages[0]?.role === "system") {
    messages[0] = { role: "system", content: systemPromptOverride };
  }
  const start = Date.now();

  const response = await client.chat.completions.create({
    model,
    messages,
    response_format: DESIGN_CARD_RESPONSE_FORMAT,
  });

  const latencyMs = Date.now() - start;
  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("LLM returned no content");

  const args = JSON.parse(content);
  return { response: parseArgs(args), rawArgs: args, latencyMs };
}

// ---------------------------------------------------------------------------
// Anthropic-native LLM call (for eval / direct Anthropic API usage)
// ---------------------------------------------------------------------------

export async function callLLMAnthropic(
  apiKey: string,
  model: string,
  prompt: string,
  originalCardData?: CardData,
  mode: string = "create",
  systemPromptOverride?: string,
): Promise<LLMCallResult> {
  const messages = buildMessages(prompt, originalCardData, mode);
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
  originalCardData?: CardData,
  mode: string = "create"
): Promise<LLMCardResponse> {
  const { client, model } = getDefaultClient();

  const MAX_RETRIES = 3;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      console.log(`[LLM] Attempt ${attempt + 1}/${MAX_RETRIES} with ${model}`);
      const result = await callLLM(client, model, prompt, originalCardData, mode);
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
