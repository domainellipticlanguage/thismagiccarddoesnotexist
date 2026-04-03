import { v4 as uuid } from "uuid";
import type { CardDocument, CardRecord, ArtDirectives, FaceArtDirective, ArtReference } from "./types.js";
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
  putCard,
  markSuperseded,
} from "./card-table.js";

/** Resolve an _old art reference to a URL from the original card. */
function resolveOldArtReference(ref: ArtReference, originalCard: CardDocument): string | undefined {
  if (ref === "primary_old") return originalCard.cardData.artUrl;
  if (ref === "secondary_old") return originalCard.cardData.linkedCard?.artUrl;
  return undefined;
}

/** Check if a reference is a _new reference (depends on another face being generated first). */
function isNewRef(ref: ArtReference): boolean {
  return ref === "primary_new" || ref === "secondary_new";
}

/** Get the face index a _new reference points to (0=primary, 1=secondary). */
function newRefFaceIndex(ref: ArtReference): number {
  return ref === "primary_new" ? 0 : 1;
}

/** Validate and sanitize directives: detect circular deps, self-refs, missing faces. */
function sanitizeDirectives(
  artDirectives: ArtDirectives | undefined,
  faceCount: number,
): ArtDirectives | undefined {
  if (!artDirectives) return undefined;

  const sanitized = { ...artDirectives };
  const primaryRef = sanitized.primary?.reference;
  const secondaryRef = sanitized.secondary?.reference;

  // Self-references: primary referencing primary_new, secondary referencing secondary_new
  if (primaryRef === "primary_new") {
    console.log(`[Art] Sanitize: primary references primary_new (self-ref) → falling back to coarse_grained_edit`);
    sanitized.primary = { mode: "coarse_grained_edit" };
  }
  if (secondaryRef === "secondary_new") {
    console.log(`[Art] Sanitize: secondary references secondary_new (self-ref) → falling back to coarse_grained_edit`);
    sanitized.secondary = { mode: "coarse_grained_edit" };
  }

  // Circular: primary→secondary_new AND secondary→primary_new
  if (sanitized.primary?.reference === "secondary_new" && sanitized.secondary?.reference === "primary_new") {
    console.log(`[Art] Sanitize: circular dependency (primary↔secondary _new) → both fall back to coarse_grained_edit`);
    sanitized.primary = { mode: "coarse_grained_edit" };
    sanitized.secondary = { mode: "coarse_grained_edit" };
  }

  // References to non-existent faces
  if (faceCount < 2) {
    if (sanitized.primary?.reference === "secondary_new") {
      console.log(`[Art] Sanitize: primary references secondary_new but only 1 face → falling back to coarse_grained_edit`);
      sanitized.primary = { mode: "coarse_grained_edit" };
    }
  }
  if (sanitized.secondary?.reference === "primary_new" && faceCount < 1) {
    // Shouldn't happen, but be safe
    sanitized.secondary = { mode: "coarse_grained_edit" };
  }

  return sanitized;
}

/** Generate/edit/copy art for a single face. */
async function generateArtForFace(
  data: CardData,
  directive: FaceArtDirective | undefined,
  faceIndex: number,
  dims: { width: number; height: number },
  originalCard: CardDocument | undefined,
  newFaceArts: Map<number, string>,
): Promise<void> {
  if (data.artUrl) return; // already has art

  const mode = directive?.mode ?? "coarse_grained_edit";
  const ref = directive?.reference ?? "primary_old";

  console.log(`[Art] Face ${faceIndex}: directive=${JSON.stringify(directive ?? "none")} → mode=${mode}, ref=${ref}`);

  // Resolve the reference URL
  let refUrl: string | undefined;
  if (isNewRef(ref)) {
    refUrl = newFaceArts.get(newRefFaceIndex(ref));
    if (!refUrl) {
      console.log(`[Art] Face ${faceIndex}: _new ref ${ref} has no art yet, falling back to generate`);
    }
  } else if (originalCard) {
    refUrl = resolveOldArtReference(ref, originalCard);
  }

  if (mode === "no_edit" && refUrl) {
    data.artUrl = refUrl;
    console.log(`[Art] Face ${faceIndex}: no_edit — copied art from ${ref}`);
    return;
  }
  if (mode === "no_edit" && !refUrl) {
    console.log(`[Art] Face ${faceIndex}: no_edit requested but ref ${ref} has no art URL, falling back to generate`);
  }

  if (mode === "fine_grained_edit" && refUrl && data.artDescription) {
    console.log(`[Art] Face ${faceIndex}: fine_grained_edit — Kontext editing from ${ref} (${dims.width}x${dims.height})`);
    data.artUrl = await editArt(
      data.artDescription,
      refUrl,
      dims.width,
      dims.height,
    );
    return;
  }
  if (mode === "fine_grained_edit") {
    console.log(`[Art] Face ${faceIndex}: fine_grained_edit requested but ref ${ref} has no art URL or no artDescription, falling back to generate`);
  }

  // coarse_grained_edit or fallback
  if (data.artDescription) {
    console.log(`[Art] Face ${faceIndex}: coarse_grained_edit — generating from scratch (${dims.width}x${dims.height})`);
    data.artUrl = await generateArt(
      data.artDescription,
      dims.width,
      dims.height,
    );
  } else {
    console.log(`[Art] Face ${faceIndex}: no artDescription, skipping`);
  }
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
  const sanitized = sanitizeDirectives(artDirectives, faces.length);
  // Update directives on faces after sanitization
  if (sanitized) {
    faces[0].directive = sanitized.primary;
    if (faces[1]) faces[1].directive = sanitized.secondary;
  }

  console.log(`[Art] ${faces.length} face(s), directives=${JSON.stringify(sanitized ?? "none")}, originalCard=${originalCard ? "yes" : "no"}`);

  // Track generated art URLs for _new references
  const newFaceArts = new Map<number, string>();

  // Determine dependency order: faces with _new refs must wait for their dependency
  const independent: typeof faces = [];
  const dependent: (typeof faces[0] & { dependsOn: number })[] = [];

  for (const face of faces) {
    const ref = face.directive?.reference;
    if (ref && isNewRef(ref)) {
      dependent.push({ ...face, dependsOn: newRefFaceIndex(ref) });
    } else {
      independent.push(face);
    }
  }

  // Phase 1: generate all independent faces in parallel
  await Promise.all(independent.map(async (face) => {
    const targetDims = face.faceIndex === 0
      ? dims.primaryArtDimensions
      : dims.secondaryArtDimensions ?? dims.primaryArtDimensions;
    await generateArtForFace(face.data, face.directive, face.faceIndex, targetDims, originalCard, newFaceArts);
    if (face.data.artUrl) {
      newFaceArts.set(face.faceIndex, face.data.artUrl);
    }
  }));

  // Phase 2: generate dependent faces (sequentially — each may depend on a phase-1 result)
  for (const face of dependent) {
    const targetDims = face.faceIndex === 0
      ? dims.primaryArtDimensions
      : dims.secondaryArtDimensions ?? dims.primaryArtDimensions;
    await generateArtForFace(face.data, face.directive, face.faceIndex, targetDims, originalCard, newFaceArts);
    if (face.data.artUrl) {
      newFaceArts.set(face.faceIndex, face.data.artUrl);
    }
  }
}

/** Copy typeLine and linkType from normalizedCardData onto the user/LLM cardData. */
function applyNormalizedFields(cardData: CardData, normalized: CardData): void {
  let src: CardData | undefined = normalized;
  let dst: CardData | undefined = cardData;
  while (src && dst) {
    dst.typeLine = src.typeLine;
    dst.linkType = src.linkType;
    src = src.linkedCard;
    dst = dst.linkedCard;
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
    suggestionArtwork: llmResult.suggestion_artwork,
    suggestionMechanics: llmResult.suggestion_mechanics,
    artDirectives: llmResult.art_directives,
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
  applyNormalizedFields(cardData, rendered.normalizedCardData as CardData);

  const record: CardRecord = {
    id: cardId,
    cardData,
    renderedUrls,
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
  };

  await putCard(record);
  await markSuperseded(originalCardId);
  return record;
}
