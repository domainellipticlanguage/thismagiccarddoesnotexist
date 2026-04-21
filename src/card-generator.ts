import { v4 as uuid } from "uuid";
import type { CardDocument, CardRecord, ArtDirective } from "./types.js";
import type { CardData } from "mtg-crucible";
import { createCard as llmCreateCard } from "./llm-client.js";
import { generateArt, editArt } from "./art-generator.js";
import {
  getArtDimensions,
  normalizeCard,
  renderAndUpload,
} from "./card-renderer.js";
import {
  getCard,
  putCard,
  markSuperseded,
} from "./card-table.js";

/** Resolve art URL for a single face given its directive and the other face's context. */
async function resolveFaceArt(
  face: CardData,
  directive: ArtDirective,
  dims: { width: number; height: number } | undefined,
  selfOriginalUrl: string | undefined,
  otherOriginalUrl: string | undefined,
  otherNewUrl: string | undefined,
): Promise<string | undefined> {
  if (!dims) return undefined; // single-art layout (e.g. Adventure); skip this face
  const { width, height } = dims;
  const desc = face.artDescription ?? "";

  switch (directive) {
    case "keep_self":
      if (selfOriginalUrl) return selfOriginalUrl;
      // fallthrough: nothing to keep, generate
      return desc ? generateArt(desc, width, height) : undefined;
    case "keep_other":
      if (otherOriginalUrl) return otherOriginalUrl;
      return desc ? generateArt(desc, width, height) : undefined;
    case "edit_self":
      return selfOriginalUrl && desc
        ? editArt(desc, selfOriginalUrl, width, height)
        : desc ? generateArt(desc, width, height) : undefined;
    case "edit_other": {
      const src = otherNewUrl ?? otherOriginalUrl;
      return src && desc
        ? editArt(desc, src, width, height)
        : desc ? generateArt(desc, width, height) : undefined;
    }
    case "generate":
    default:
      return desc ? generateArt(desc, width, height) : undefined;
  }
}

/** Generate art for all faces of the card, respecting per-face directives and dep ordering. */
async function generateArtForAllFaces(
  cardData: CardData,
  artDirectives: ArtDirective[],
  originalCard: CardDocument | undefined,
): Promise<void> {
  const normalized = normalizeCard(cardData);
  const dims = getArtDimensions(normalized);

  const faces = [cardData, cardData.linkedCard].filter((f): f is CardData => !!f);
  const faceDims = [dims.primaryArtDimensions, dims.secondaryArtDimensions];
  const originalFaces = [originalCard?.cardData, originalCard?.cardData.linkedCard];
  const directives = faces.map((_, i) => artDirectives[i] ?? "generate");

  const newUrls: (string | undefined)[] = new Array(faces.length).fill(undefined);

  // Pass 1: resolve faces that don't depend on the other face's new art.
  await Promise.all(
    faces.map(async (face, i) => {
      if (directives[i] === "edit_other") return;
      newUrls[i] = await resolveFaceArt(
        face,
        directives[i],
        faceDims[i],
        originalFaces[i]?.artUrl,
        originalFaces[1 - i]?.artUrl,
        undefined,
      );
    })
  );

  // Pass 2: resolve edit_other faces (can now reference the other face's new URL).
  for (let i = 0; i < faces.length; i++) {
    if (directives[i] !== "edit_other") continue;
    newUrls[i] = await resolveFaceArt(
      faces[i],
      directives[i],
      faceDims[i],
      originalFaces[i]?.artUrl,
      originalFaces[1 - i]?.artUrl,
      newUrls[1 - i],
    );
  }

  // Apply
  if (newUrls[0] && !cardData.artUrl) cardData.artUrl = newUrls[0];
  if (newUrls[1] && cardData.linkedCard && !cardData.linkedCard.artUrl) {
    cardData.linkedCard.artUrl = newUrls[1];
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
  cardData.artist = "prunaai/p-image";
  cardData.designer = "thismagiccarddoesnotexist.com";
  if (cardData.linkedCard) {
    cardData.linkedCard.artist = "prunaai/p-image";
    cardData.linkedCard.designer = "thismagiccarddoesnotexist.com";
  }
  console.log("[Pipeline] Card:", cardData.name);

  // 3. Art
  console.log("[Pipeline] 3. Art", llmResult.artDirectives);
  await generateArtForAllFaces(cardData, llmResult.artDirectives, originalCard);

  // 4. Render
  console.log("[Pipeline] 4. Render");
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
