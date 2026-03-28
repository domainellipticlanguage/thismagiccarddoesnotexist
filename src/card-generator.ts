import { v4 as uuid } from "uuid";
import type { CardDocument } from "./types.js";
import type { CardData } from "@domainellipticlanguage/mtg-crucible";
import { createCard as llmCreateCard } from "./llm-client.js";
import { generateArt } from "./art-generator.js";
import {
  parseCard,
  getArtDimensions,
  getArtDimensionsFromText,
  renderAndUpload,
} from "./card-renderer.js";
import {
  getCard,
  putCardRows,
  flattenCardData,
  markSuperseded,
} from "./card-table.js";

/** Generate art for every face in the linkedCard chain. */
async function generateArtForAllFaces(cardData: CardData): Promise<void> {
  let current: CardData | undefined = cardData;
  while (current) {
    if (current.artDescription && !current.artUrl) {
      const dims = getArtDimensions(current);
      current.artUrl = await generateArt(
        current.artDescription,
        dims.width,
        dims.height
      );
    }
    current = current.linkedCard;
  }
}

/** Strip artUrl from all faces (keep artDescription). Used before persisting. */
function stripArtUrls(cardData: CardData): void {
  let current: CardData | undefined = cardData;
  while (current) {
    delete current.artUrl;
    current = current.linkedCard;
  }
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

  // 2. Parse
  console.log("[Pipeline] 2. Parse");
  console.log("[Pipeline] LLM card_text:\n" + llmResult.card_text);
  const { cardData } = getArtDimensionsFromText(llmResult.card_text);

  // 3. Art — generate for every face
  console.log("[Pipeline] 3. Art");
  await generateArtForAllFaces(cardData);

  // 4. Render
  console.log("[Pipeline] 4. Render");
  const { rendered, renderedUrls, rotations } = await renderAndUpload(cardData);

  // 5. Store
  console.log("[Pipeline] 5. Store");
  const rows = flattenCardData(cardId, cardData, renderedUrls, {
    crucibleText: rendered.crucibleText,
    scryfallText: rendered.scryfallText,
    scryfallJson: rendered.scryfallJson,
    rotations,
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

  return {
    id: cardId,
    cardData,
    crucibleText: rendered.crucibleText,
    scryfallText: rendered.scryfallText,
    scryfallJson: rendered.scryfallJson,
    rotations,
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
    renderedUrls,
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

  await generateArtForAllFaces(cardData);

  const { rendered, renderedUrls, rotations } = await renderAndUpload(cardData);

  const rows = flattenCardData(cardId, cardData, renderedUrls, {
    crucibleText: rendered.crucibleText,
    scryfallText: rendered.scryfallText,
    scryfallJson: rendered.scryfallJson,
    rotations,
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
    scryfallJson: rendered.scryfallJson,
    rotations,
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
    renderedUrls,
  };
}
