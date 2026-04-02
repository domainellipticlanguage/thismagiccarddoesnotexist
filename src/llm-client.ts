import OpenAI from "openai";
import type { CardData, LinkType, Rarity, Color } from "@domainellipticlanguage/mtg-crucible";
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
        artEditMode: {
          type: "string",
          enum: ["keep", "edit", "regenerate"],
          description: "For edit mode only: keep existing art, edit it, or regenerate from scratch",
        },
      },
      required: ["card", "explanation", "suggestionArtwork", "suggestionMechanics"],
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
  const cardData: CardData = {
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

  return cardData;
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a Magic: The Gathering card designer. Use the design_card tool to create cards.

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
- Use linkedCard + linkType for double-faced cards, adventures, split cards, etc.`;

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
      {
        role: "system",
        content: SYSTEM_PROMPT + `\n\nWhen editing, also set artEditMode:
- "keep" — keep the existing art unchanged (default if art is not mentioned)
- "edit" — make fine-tuned edits to the existing art. Put ONLY the delta/changes in artDescription.
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

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

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
        tools: [DESIGN_CARD_TOOL],
        tool_choice: { type: "function", function: { name: "design_card" } },
      });

      console.log(`[LLM] Response in ${((Date.now() - start) / 1000).toFixed(2)}s`);

      const toolCall = response.choices[0]?.message?.tool_calls?.[0];
      if (!toolCall || toolCall.function.name !== "design_card") {
        throw new Error("LLM did not call design_card tool");
      }

      const args = JSON.parse(toolCall.function.arguments);
      const card: LLMCard = args.card;
      if (!card?.name) throw new Error("Missing card name in tool call");

      const cardData = llmCardToCardData(card, args.linkType, args.linkedCard);

      return {
        cardData,
        explanation: args.explanation || "",
        suggestion_artwork: args.suggestionArtwork || "",
        suggestion_mechanics: args.suggestionMechanics || "",
        art_edit_mode: args.artEditMode,
      };
    } catch (err: any) {
      lastError = err;
      console.error(`[LLM] Attempt ${attempt + 1} failed:`, err.message);
    }
  }

  throw new Error(`Failed after ${MAX_RETRIES} attempts: ${lastError?.message}`);
}
