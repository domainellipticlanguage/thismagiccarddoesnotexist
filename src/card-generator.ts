import { v4 as uuid } from "uuid";
import type { CardDocument, ArtDirectives, FaceArtDirective, ArtReference } from "./types.js";
import type { CardData } from "@domainellipticlanguage/mtg-crucible";
import { createCard as llmCreateCard } from "./llm-client.js";
import { generateArt, editArt } from "./art-generator.js";
import {
  parseCard,
  getArtDimensions,
  renderAndUpload,
} from "./card-renderer.js";
import {
  getCard,
  putCardRows,
  flattenCardData,
  markSuperseded,
} from "./card-table.js";

/** Resolve an art reference to a URL from the original card. */
function resolveArtReference(ref: ArtReference, originalCard: CardDocument): string | undefined {
  if (ref === "primary_old") return originalCard.cardData.artUrl;
  if (ref === "secondary_old") return originalCard.cardData.linkedCard?.artUrl;
  return undefined;
}

/** Generate/edit/copy art for every face based on art directives. */
async function generateArtForAllFaces(
  cardData: CardData,
  artDirectives?: ArtDirectives,
  originalCard?: CardDocument,
): Promise<void> {
  // Collect faces with their directives
  const faces: { data: CardData; directive?: FaceArtDirective; faceIndex: number }[] = [];
  let current: CardData | undefined = cardData;
  let index = 0;
  while (current) {
    const key = index === 0 ? "primary" : "secondary";
    faces.push({
      data: current,
      directive: artDirectives?.[key as keyof ArtDirectives] as FaceArtDirective | undefined,
      faceIndex: index,
    });
    current = current.linkedCard;
    index++;
  }

  const dims = getArtDimensions(cardData);
  console.log(`[Art] ${faces.length} face(s), directives=${JSON.stringify(artDirectives ?? "none")}, originalCard=${originalCard ? "yes" : "no"}`);

  // Process all faces in parallel (no _new deps, only _old references)
  await Promise.all(faces.map(async ({ data, directive, faceIndex }) => {
    if (data.artUrl) return; // already has art

    const targetDims = faceIndex === 0
      ? dims.primaryArtDimensions
      : dims.secondaryArtDimensions ?? dims.primaryArtDimensions;

    const mode = directive?.mode ?? "coarse_grained_edit";
    const ref = directive?.reference ?? "primary_old";

    console.log(`[Art] Face ${faceIndex}: directive=${JSON.stringify(directive ?? "none")} → mode=${mode}, ref=${ref}`);

    if (mode === "no_edit" && originalCard) {
      const refUrl = resolveArtReference(ref, originalCard);
      if (refUrl) {
        data.artUrl = refUrl;
        console.log(`[Art] Face ${faceIndex}: no_edit — copied art from ${ref}`);
        return;
      }
      console.log(`[Art] Face ${faceIndex}: no_edit requested but ref ${ref} has no art URL, falling back to generate`);
    }

    if (mode === "fine_grained_edit" && originalCard) {
      const refUrl = resolveArtReference(ref, originalCard);
      if (refUrl && data.artDescription) {
        console.log(`[Art] Face ${faceIndex}: fine_grained_edit — Kontext editing from ${ref} (${targetDims.width}x${targetDims.height})`);
        data.artUrl = await editArt(
          data.artDescription,
          refUrl,
          targetDims.width,
          targetDims.height,
        );
        return;
      }
      console.log(`[Art] Face ${faceIndex}: fine_grained_edit requested but ref ${ref} has no art URL or no artDescription, falling back to generate`);
    }

    // coarse_grained_edit or fallback
    if (data.artDescription) {
      console.log(`[Art] Face ${faceIndex}: coarse_grained_edit — generating from scratch (${targetDims.width}x${targetDims.height})`);
      data.artUrl = await generateArt(
        data.artDescription,
        targetDims.width,
        targetDims.height,
      );
    } else {
      console.log(`[Art] Face ${faceIndex}: no artDescription, skipping`);
    }
  }));
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

  // 2. CardData from LLM (already structured)
  console.log("[Pipeline] 2. CardData");
  const cardData = llmResult.cardData;
  console.log("[Pipeline] Card:", cardData.name);

  // 3. Art — generate/edit/copy for every face
  console.log("[Pipeline] 3. Art");
  await generateArtForAllFaces(cardData, llmResult.art_directives, originalCard);

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
    artDirectives: llmResult.art_directives,
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
    artDirectives: llmResult.art_directives,
    creatorId,
    parentId: originalCardId,
    createdDate: new Date().toISOString(),
    isDeleted: false,
    isFinished: true,
    isSuperseded: false,
    renderedUrls,
  };
}

/** Build implicit art directives for field edits: keep art if description unchanged. */
function buildImplicitDirectives(newCard: CardData, original: CardDocument): ArtDirectives {
  const primary: FaceArtDirective =
    newCard.artDescription === original.cardData.artDescription && original.cardData.artUrl
      ? { mode: "no_edit", reference: "primary_old" }
      : { mode: "coarse_grained_edit" };

  let secondary: FaceArtDirective | undefined;
  if (newCard.linkedCard && original.cardData.linkedCard) {
    secondary =
      newCard.linkedCard.artDescription === original.cardData.linkedCard.artDescription && original.cardData.linkedCard.artUrl
        ? { mode: "no_edit", reference: "secondary_old" }
        : { mode: "coarse_grained_edit" };
  }

  return { primary, secondary };
}

export async function applyFieldEdits(
  originalCardId: string,
  creatorId: string,
  newCrucibleText?: string,
  rawCardData?: CardData,
): Promise<CardDocument> {
  const original = await getCard(originalCardId);
  if (!original) throw new Error(`Card ${originalCardId} not found`);

  const cardId = uuid();
  const cardData: CardData = rawCardData ?? parseCard(newCrucibleText!);

  // Build implicit art directives: keep art if description unchanged
  const artDirectives = buildImplicitDirectives(cardData, original);
  await generateArtForAllFaces(cardData, artDirectives, original);

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
