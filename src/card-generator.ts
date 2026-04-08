import { v4 as uuid } from "uuid";
import type { CardDocument, CardRecord, ArtEditMode } from "./types.js";
import type { CardData } from "mtg-crucible";
import { createCard as llmCreateCard } from "./llm-client.js";
import { generateArt, editArt } from "./art-generator.js";
import {
  parseCard,
  getArtDimensions,
  renderAndUpload,
} from "./card-renderer.js";
import {
  getCard,
  putCard,
  markSuperseded,
} from "./card-table.js";

/** Generate or edit art for a single-face card based on art edit mode. */
async function handleArt(
  cardData: CardData,
  artEditMode: ArtEditMode | undefined,
  originalCard: CardDocument | undefined,
): Promise<void> {
  if (cardData.artUrl) return; // already has art

  const dims = getArtDimensions(cardData);
  const { width, height } = dims.primaryArtDimensions;
  const mode = artEditMode ?? "regenerate";
  const originalArtUrl = originalCard?.cardData.artUrl;

  console.log(`[Art] mode=${mode}, originalArt=${originalArtUrl ? "yes" : "no"}`);

  if (mode === "keep" && originalArtUrl) {
    cardData.artUrl = originalArtUrl;
    console.log(`[Art] Keeping existing art`);
    return;
  }

  if (mode === "edit" && originalArtUrl && cardData.artDescription) {
    console.log(`[Art] Fine-grained edit via Kontext (${width}x${height})`);
    cardData.artUrl = await editArt(cardData.artDescription, originalArtUrl, width, height);
    return;
  }

  if (mode === "edit" && !originalArtUrl) {
    console.log(`[Art] Edit requested but no original art, falling back to generate`);
  }

  // regenerate or fallback
  if (cardData.artDescription) {
    console.log(`[Art] Generating new art (${width}x${height})`);
    cardData.artUrl = await generateArt(cardData.artDescription, width, height);
  } else {
    console.log(`[Art] No artDescription, skipping art generation`);
  }
}

/** Copy typeLine and linkType from normalizedCardData onto the cardData. */
function applyNormalizedFields(cardData: CardData, normalized: CardData): void {
  cardData.typeLine = normalized.typeLine;
  cardData.linkType = normalized.linkType;
}

export async function generateCard(
  description: string,
  originalCardId: string | undefined,
  creatorId: string,
  mode: "create" | "edit" | "copy"
): Promise<CardDocument> {
  const cardId = uuid();
  console.log(`[Pipeline] ${mode} card ${cardId}`);

  let originalCard: CardDocument | undefined;
  let originalCrucibleText: string | undefined;
  if (originalCardId && (mode === "edit" || mode === "copy")) {
    originalCard = await getCard(originalCardId);
    if (!originalCard) throw new Error(`Original card ${originalCardId} not found`);
    originalCrucibleText = originalCard.crucibleText;
  }

  // 1. LLM
  console.log("[Pipeline] 1. LLM");
  const llmResult = await llmCreateCard(description, originalCrucibleText, mode);

  // 2. CardData from LLM
  console.log("[Pipeline] 2. CardData");
  const cardData = llmResult.cardData;
  console.log("[Pipeline] Card:", cardData.name);

  // 3. Art
  console.log("[Pipeline] 3. Art");
  await handleArt(cardData, llmResult.artEditMode, originalCard);

  // 4. Render
  console.log("[Pipeline] 4. Render");
  const llmCardData = structuredClone(cardData);
  const { rendered, renderedUrls, rotations } = await renderAndUpload(cardData);
  applyNormalizedFields(cardData, rendered.normalizedCardData as CardData);

  // 5. Store
  console.log("[Pipeline] 5. Store");
  const record: CardRecord = {
    id: cardId,
    cardData,
    renderedUrls,
    crucibleText: rendered.crucibleText,
    scryfallText: rendered.scryfallText,
    scryfallJson: rendered.scryfallJson,
    rotations,
    prompt: description,
    explanation: llmResult.explanation,
    llmCardData,
    creatorId,
    parentId: originalCardId,
    createdDate: new Date().toISOString(),
    isDeleted: false,
    isFinished: true,
    isSuperseded: false,
  };

  await putCard(record);
  if (mode === "edit" && originalCardId) {
    await markSuperseded(originalCardId);
  }

  console.log(`[Pipeline] Done: ${cardId}`);
  return record;
}
