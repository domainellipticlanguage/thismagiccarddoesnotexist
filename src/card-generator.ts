import { v4 as uuid } from "uuid";
import type { CardDocument } from "./types.js";
import { createCard as llmCreateCard } from "./llm-client.js";
import { generateArt, editArt } from "./art-generator.js";
import {
  parseCard,
  getArtDimensionsFromText,
  renderAndUpload,
} from "./card-renderer.js";
import { getPresignedUrl } from "./s3-storage.js";
import {
  getCard,
  putCardRows,
  flattenCardData,
  markSuperseded,
} from "./card-table.js";

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

  // 2. Parse & art dimensions
  console.log("[Pipeline] 2. Parse");
  console.log("[Pipeline] LLM card_text:\n" + llmResult.card_text);
  const { width, height, cardData } = getArtDimensionsFromText(llmResult.card_text);

  // 3. Art — returns raw S3 URI
  console.log("[Pipeline] 3. Art");
  const artDescription = cardData.artDescription || description;
  let artS3Uri: string;

  if (mode === "edit" && originalCard && llmResult.art_edit_mode === "keep" && originalCard.renderedS3Uris?.[0]) {
    // Keep existing — use the original card's art
    artS3Uri = originalCard.renderedS3Uris[0]; // TODO: track art S3 URI separately if needed
  } else {
    artS3Uri = await generateArt(artDescription, width, height);
  }

  // 4. Render — sign the art URL so crucible can fetch it
  console.log("[Pipeline] 4. Render");
  cardData.artUrl = await getPresignedUrl(artS3Uri);

  // TODO: if linkedCard has its own art, generate/sign that too
  const { rendered, renderedS3Uris } = await renderAndUpload(cardData);

  // 5. Store — flatten into rows
  console.log("[Pipeline] 5. Store");
  const rows = flattenCardData(cardId, cardData, renderedS3Uris, {
    crucibleText: rendered.crucibleText,
    scryfallText: rendered.scryfallText,
    prompt: description,
    explanation: llmResult.explanation,
    suggestionArtwork: llmResult.suggestion_artwork,
    suggestionMechanics: llmResult.suggestion_mechanics,
    artEditMode: llmResult.art_edit_mode,
    creatorId,
    parentId: originalCardId,
    createdDate: new Date().toISOString(),
    isDeleted: false,
    isFinished: true,
    isSuperseded: false,
  });

  await putCardRows(rows);
  if (mode === "edit" && originalCardId) {
    await markSuperseded(originalCardId);
  }

  console.log(`[Pipeline] Done: ${cardId}`);

  // Return assembled record
  return {
    id: cardId,
    cardData,
    crucibleText: rendered.crucibleText,
    scryfallText: rendered.scryfallText,
    prompt: description,
    explanation: llmResult.explanation,
    suggestionArtwork: llmResult.suggestion_artwork,
    suggestionMechanics: llmResult.suggestion_mechanics,
    artEditMode: llmResult.art_edit_mode,
    creatorId,
    parentId: originalCardId,
    createdDate: new Date().toISOString(),
    isDeleted: false,
    isFinished: true,
    isSuperseded: false,
    renderedS3Uris,
  };
}

export async function applyFieldEdits(
  originalCardId: string,
  newCrucibleText: string,
  creatorId: string
): Promise<CardDocument> {
  const original = await getCard(originalCardId);
  if (!original) throw new Error(`Card ${originalCardId} not found`);

  const cardId = uuid();
  const cardData = parseCard(newCrucibleText);

  // TODO: handle art regeneration for edits
  // For now, reuse original art if available
  if (original.renderedS3Uris?.[0]) {
    cardData.artUrl = await getPresignedUrl(original.renderedS3Uris[0]);
  }

  const { rendered, renderedS3Uris } = await renderAndUpload(cardData);

  const rows = flattenCardData(cardId, cardData, renderedS3Uris, {
    crucibleText: rendered.crucibleText,
    scryfallText: rendered.scryfallText,
    prompt: original.prompt,
    explanation: original.explanation,
    suggestionArtwork: original.suggestionArtwork,
    suggestionMechanics: original.suggestionMechanics,
    creatorId,
    parentId: originalCardId,
    createdDate: new Date().toISOString(),
    isDeleted: false,
    isFinished: true,
    isSuperseded: false,
  });

  await putCardRows(rows);
  await markSuperseded(originalCardId);

  return {
    id: cardId,
    cardData,
    crucibleText: rendered.crucibleText,
    scryfallText: rendered.scryfallText,
    prompt: original.prompt,
    explanation: original.explanation,
    suggestionArtwork: original.suggestionArtwork,
    suggestionMechanics: original.suggestionMechanics,
    creatorId,
    parentId: originalCardId,
    createdDate: new Date().toISOString(),
    isDeleted: false,
    isFinished: true,
    isSuperseded: false,
    renderedS3Uris,
  };
}
