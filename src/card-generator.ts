import { v4 as uuid } from "uuid";
import type { CardRecord } from "./types.js";
import { createCard as llmCreateCard } from "./llm-client.js";
import { generateArt, editArt } from "./art-generator.js";
import {
  parseCard,
  getArtDimensionsFromText,
  renderAndUpload,
} from "./card-renderer.js";
import {
  getCard,
  putCard,
  nextSequenceNumber,
  markSuperseded,
} from "./card-table.js";

export async function generateCard(
  description: string,
  originalCardId: string | undefined,
  creatorId: string,
  mode: "create" | "edit" | "copy"
): Promise<CardRecord> {
  const cardId = uuid();
  console.log(`[Pipeline] ${mode} card ${cardId}`);

  let originalCard: CardRecord | undefined;
  let originalCrucibleText: string | undefined;
  if (originalCardId && (mode === "edit" || mode === "copy")) {
    originalCard = await getCard(originalCardId);
    if (!originalCard) throw new Error(`Original card ${originalCardId} not found`);
    originalCrucibleText = originalCard.crucibleText;
  }

  // 1. LLM
  console.log("[Pipeline] 1. LLM");
  const llmResult = await llmCreateCard(description, originalCrucibleText, mode);

  // 2. Parse & art dimensions
  console.log("[Pipeline] 2. Parse");
  const { width, height, cardData } = getArtDimensionsFromText(llmResult.card_text);

  // 3. Art
  console.log("[Pipeline] 3. Art");
  const artDescription = cardData.artDescription || description;
  let artUrl: string;

  if (mode === "edit" && originalCard && llmResult.art_edit_mode === "keep" && originalCard.artUrl) {
    artUrl = originalCard.artUrl;
  } else if (mode === "edit" && originalCard && llmResult.art_edit_mode === "edit" && originalCard.artUrl) {
    artUrl = await editArt(artDescription, originalCard.artUrl, width, height);
  } else {
    artUrl = await generateArt(artDescription, width, height);
  }

  // 4. Render
  console.log("[Pipeline] 4. Render");
  cardData.artUrl = artUrl;
  const { rendered, renderedS3Uri, renderedUrl } = await renderAndUpload(cardData);

  // 5. Store
  console.log("[Pipeline] 5. Store");
  const sequenceNumber = await nextSequenceNumber();

  const record: CardRecord = {
    id: cardId,
    crucibleText: rendered.crucibleText,
    cardData,
    scryfallText: rendered.scryfallText,
    prompt: description,
    explanation: llmResult.explanation,
    suggestionArtwork: llmResult.suggestion_artwork,
    suggestionMechanics: llmResult.suggestion_mechanics,
    artEditMode: llmResult.art_edit_mode,
    artUrl,
    artS3Uri: "",
    renderedS3Uri,
    renderedUrl,
    creatorId,
    parentId: originalCardId,
    sequenceNumber,
    dummyHashKey: 0,
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

export async function applyFieldEdits(
  originalCardId: string,
  newCrucibleText: string,
  creatorId: string
): Promise<CardRecord> {
  const original = await getCard(originalCardId);
  if (!original) throw new Error(`Card ${originalCardId} not found`);

  const cardId = uuid();
  const cardData = parseCard(newCrucibleText);

  let artUrl = original.artUrl;
  const oldArtDesc = original.cardData?.artDescription;
  const newArtDesc = cardData.artDescription;

  if (newArtDesc && newArtDesc !== oldArtDesc) {
    const { width, height } = getArtDimensionsFromText(newCrucibleText);
    artUrl = await generateArt(newArtDesc, width, height);
  }

  cardData.artUrl = artUrl;
  const { rendered, renderedS3Uri, renderedUrl } = await renderAndUpload(cardData);
  const sequenceNumber = await nextSequenceNumber();

  const record: CardRecord = {
    id: cardId,
    crucibleText: rendered.crucibleText,
    cardData,
    scryfallText: rendered.scryfallText,
    prompt: original.prompt,
    explanation: original.explanation,
    suggestionArtwork: original.suggestionArtwork,
    suggestionMechanics: original.suggestionMechanics,
    artUrl,
    artS3Uri: "",
    renderedS3Uri,
    renderedUrl,
    creatorId,
    parentId: originalCardId,
    sequenceNumber,
    dummyHashKey: 0,
    createdDate: new Date().toISOString(),
    isDeleted: false,
    isFinished: true,
    isSuperseded: false,
  };

  await putCard(record);
  await markSuperseded(originalCardId);
  return record;
}
