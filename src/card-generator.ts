import { v4 as uuid } from "uuid";
import type { CardDocument, CardRecord, ArtDirective } from "./types.js";
import type { CardData, RenderedCard } from "mtg-crucible";
import { createCard as llmCreateCard } from "./llm-client.js";
import { generateArt, editArt, ART_MODEL } from "./art-generator.js";
import {
  getArtDimensions,
  normalizeCard,
  renderCardOnly,
  renderThumbnailOnly,
  uploadFaces,
  uploadThumbnailFaces,
} from "./card-renderer.js";
import {
  getCard,
  commitCard,
  GALLERY_PARTITION,
} from "./card-table.js";
import { uploadBuffer, getPublicUrl } from "./s3-storage.js";

/** Credit shown as a card's designer when the creator leaves it blank. */
export const DEFAULT_DESIGNER = "thismagiccarddoesnotexist.com";

/** Fall back to the site credit for any face missing an explicit designer. */
function applyDesignerDefault(cardData: CardData): void {
  if (!cardData.designer) cardData.designer = DEFAULT_DESIGNER;
  if (cardData.linkedCard && !cardData.linkedCard.designer) {
    cardData.linkedCard.designer = DEFAULT_DESIGNER;
  }
}

/** Layouts that render a single piece of art shared across both faces of a
 *  2-card link. We merge the LLM's per-face descriptions into one prompt and
 *  hand it to the regular text-to-image generator. Mutates the primary's
 *  artDescription in place and clears the secondary's so no extra art is
 *  generated. Idempotent. */
const COMPOSITE_ART_BUILDERS: Partial<Record<NonNullable<CardData["linkType"]>, (a: string, b: string) => string>> = {
  room: (a, b) =>
    `A panoramic view of 2 scenes melded together. On the left side is ${a}. On the right side is ${b}.`,
  flip: (a, b) =>
    `Make one cohesive scene with these 2 figures. Figure 1 is on the left. Figure 2 is on the right but is upside down. The whole scene is in the style of high quality digital fantasy art

Figure 1:
${a}

Figure 2:
${b}
`,
};

function combineSharedArtDescriptions(cardData: CardData): void {
  if (!cardData.linkedCard) return;
  const linkType = normalizeCard(cardData).linkType;
  if (!linkType) return;
  const builder = COMPOSITE_ART_BUILDERS[linkType];
  if (!builder) return;
  const first = cardData.artDescription?.trim();
  const second = cardData.linkedCard.artDescription?.trim();
  if (!first || !second) return;
  cardData.artDescription = builder(first, second);
  cardData.linkedCard.artDescription = undefined;
}

/**
 * Resolve art for a single face. Returns:
 *   - `Buffer` for a freshly generated/edited image (needs to be uploaded later)
 *   - `string` for a reused S3 URL from an existing card (no upload needed)
 */
async function resolveFaceArt(
  face: CardData,
  directive: ArtDirective,
  dims: { width: number; height: number } | undefined,
  selfOriginalUrl: string | undefined,
  otherOriginalUrl: string | undefined,
  otherNew: string | Buffer | undefined,
): Promise<string | Buffer | undefined> {
  if (!dims) return undefined; // single-art layout (e.g. Adventure); skip this face
  const { width, height } = dims;
  const desc = face.artDescription ?? "";

  switch (directive) {
    case "keep_self":
      if (selfOriginalUrl) return selfOriginalUrl;
      return desc ? generateArt(desc, width, height) : undefined;
    case "keep_other":
      // Prefer the other face's existing original (art-swap case on an edit);
      // fall back to whatever the other face just generated this round (first-
      // round create where the sibling has directive=generate); last resort,
      // generate locally from this face's own description.
      if (otherOriginalUrl) return otherOriginalUrl;
      if (otherNew) return otherNew;
      return desc ? generateArt(desc, width, height) : undefined;
    case "edit_self":
      return selfOriginalUrl && desc
        ? editArt(desc, selfOriginalUrl)
        : desc ? generateArt(desc, width, height) : undefined;
    case "edit_other": {
      const src = otherNew ?? otherOriginalUrl;
      return src && desc
        ? editArt(desc, src)
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
  // crucible 0.3.5 widened artUrl to string | Buffer; we only ever store string URLs in DDB.
  const origUrls = originalFaces.map((f) => (typeof f?.artUrl === "string" ? f.artUrl : undefined));
  const directives = faces.map((_, i) => artDirectives[i] ?? "generate");

  // Provenance: when keep_self leaves artDescription empty, inherit the
  // description that was active when this art was last generated. Otherwise
  // future iterations would lose context about what's in the existing image.
  for (let i = 0; i < faces.length; i++) {
    if (directives[i] !== "keep_self") continue;
    if (faces[i].artDescription?.trim()) continue;
    const prev = originalFaces[i]?.artDescription;
    if (prev) faces[i].artDescription = prev;
  }

  const newArt: (string | Buffer | undefined)[] = new Array(faces.length).fill(undefined);

  // Pass 1: resolve faces that don't depend on the other face's new art.
  // edit_other and keep_other are deferred — they may need to fall back to
  // the sibling's freshly-generated art when no prior original exists.
  const deferred = new Set<ArtDirective>(["edit_other", "keep_other"]);
  await Promise.all(
    faces.map(async (face, i) => {
      if (deferred.has(directives[i])) return;
      newArt[i] = await resolveFaceArt(
        face,
        directives[i],
        faceDims[i],
        origUrls[i],
        origUrls[1 - i],
        undefined,
      );
    })
  );

  // Pass 2: resolve deferred faces (can now reference the other face's new art).
  for (let i = 0; i < faces.length; i++) {
    if (!deferred.has(directives[i])) continue;
    newArt[i] = await resolveFaceArt(
      faces[i],
      directives[i],
      faceDims[i],
      origUrls[i],
      origUrls[1 - i],
      newArt[1 - i],
    );
  }

  // Apply (Buffer or string — renderer accepts both).
  if (newArt[0] && !cardData.artUrl) cardData.artUrl = newArt[0];
  if (newArt[1] && cardData.linkedCard && !cardData.linkedCard.artUrl) {
    cardData.linkedCard.artUrl = newArt[1];
  }
}

/** Pre-upload step: replace each Buffer artUrl on cardData with its future S3 URL. */
function reserveArtUrls(cardData: CardData): { buffer: Buffer; key: string }[] {
  const pending: { buffer: Buffer; key: string }[] = [];
  for (const face of [cardData, cardData.linkedCard]) {
    if (!face) continue;
    if (Buffer.isBuffer(face.artUrl)) {
      const key = `art/${uuid()}.png`;
      pending.push({ buffer: face.artUrl, key });
      face.artUrl = getPublicUrl(key);
    }
  }
  return pending;
}

/** Copy typeLine and linkType from normalizedCardData onto the cardData. */
function applyNormalizedFields(cardData: CardData, normalized: CardData): void {
  cardData.typeLine = normalized.typeLine;
  cardData.linkType = normalized.linkType;
}

/** Result of phase 1 (LLM + art + render). Holds image buffers, not S3 URLs. */
export interface GeneratedCard {
  cardId: string;
  /** Art urls on cardData are already future S3 URLs (strings); the actual
   *  bytes for those URLs live in `pendingArtUploads` and are uploaded by
   *  `persistGeneratedCard`. */
  cardData: CardData;
  rendered: RenderedCard;
  /** Low-quality render used for gallery thumbnails. */
  thumbnail: RenderedCard;
  pendingArtUploads: { buffer: Buffer; key: string }[];
  prompt: string;
  creatorId: string;
  parentId?: string;
  mode: "create" | "edit" | "copy";
  createdDate: string;
}

/** Build a CardRecord from a GeneratedCard plus rendered/thumbnail URL arrays (S3 URLs or data URLs). */
export function buildCardRecord(
  g: GeneratedCard,
  renderedUrls: string[],
  thumbnailUrls: string[],
): CardRecord {
  return {
    id: g.cardId,
    cardData: g.cardData,
    renderedUrls,
    thumbnailUrls,
    dummyHashKey: GALLERY_PARTITION,
    sequenceNumber: new Date(g.createdDate).getTime(),
    crucibleText: g.rendered.crucibleText,
    scryfallText: g.rendered.scryfallText,
    scryfallJson: g.rendered.scryfallJson,
    rotations: g.rendered.rotations,
    prompt: g.prompt,
    creatorId: g.creatorId,
    parentId: g.parentId,
    createdDate: g.createdDate,
    isDeleted: false,
    isFinished: true,
    isSuperseded: false,
  };
}

/** Phase 1: LLM, art, render. Returns image buffers — no S3, no DDB. */
export async function generateRenderedCard(
  description: string,
  originalCardId: string | undefined,
  creatorId: string,
  mode: "create" | "edit" | "copy",
): Promise<GeneratedCard> {
  const cardId = uuid();
  console.log(`[Pipeline] start ${cardId} ${mode}`);

  let originalCard: CardDocument | undefined;
  if (originalCardId && (mode === "edit" || mode === "copy")) {
    originalCard = await getCard(originalCardId);
    if (!originalCard) throw new Error(`Original card ${originalCardId} not found`);
  }

  const llmResult = await llmCreateCard(description, originalCard?.cardData, mode);

  const cardData = llmResult.cardData;
  cardData.artist = ART_MODEL;
  cardData.designer = DEFAULT_DESIGNER;
  if (cardData.linkedCard) {
    cardData.linkedCard.artist = ART_MODEL;
    cardData.linkedCard.designer = DEFAULT_DESIGNER;
  }
  console.log(`[Pipeline] Card: ${cardData.name} | directives: ${llmResult.artDirectives.join(",")}`);

  // Layouts that share one art across two faces (rooms, flip): collapse the
  // LLM's two per-face descriptions into one composite before art gen +
  // persistence. Mutates cardData in place.
  combineSharedArtDescriptions(cardData);

  await generateArtForAllFaces(cardData, llmResult.artDirectives, originalCard);

  // Full render + low-q thumbnail in parallel, both while artUrls are still
  // Buffers (before reserveArtUrls swaps them for not-yet-uploaded S3 URLs).
  const [rendered, thumbnail] = await Promise.all([
    renderCardOnly(cardData),
    renderThumbnailOnly(cardData),
  ]);
  applyNormalizedFields(cardData, rendered.normalizedCardData as CardData);

  // Renderer is done with the Buffer artUrls; swap each Buffer for its
  // future S3 URL on cardData so the response (and DDB record) carries
  // proper string URLs. The bytes are queued for the persist phase.
  const pendingArtUploads = reserveArtUrls(cardData);

  return {
    cardId,
    cardData,
    rendered,
    thumbnail,
    pendingArtUploads,
    prompt: description,
    creatorId,
    parentId: originalCardId,
    mode,
    createdDate: new Date().toISOString(),
  };
}

/** Advanced edit: re-render `cardData` against an existing card (no LLM).
 *  Art is reused from the original, except for faces whose artDescription was
 *  changed in the form — those are regenerated from the new description. */
export async function applyFieldEdits(
  cardData: CardData,
  original: CardDocument,
  creatorId: string,
  // "edit" supersedes the original (it leaves the gallery); "copy" leaves the
  // original untouched and persists an independent new card (Copy & Remix).
  mode: "edit" | "copy" = "edit",
  // "No art": render an empty frame (black box) instead of generating/keeping
  // any artwork. Manual mode only.
  noArt = false,
): Promise<CardRecord> {
  const cardId = uuid();

  // Manual edits carry an explicit card-level Designer; fall back to the site
  // credit when the field is left blank.
  applyDesignerDefault(cardData);

  // The form preserves artUrl from the original (it only edits text fields), so
  // by default every face keeps its existing art. Compare each face's new
  // artDescription against the original: if it changed, regenerate that face's
  // art from the new description; otherwise inherit the original art.
  const faces = [cardData, cardData.linkedCard];
  const origFaces = [original.cardData, original.cardData.linkedCard];
  const norm = (s?: string) => (s ?? "").trim();

  const directives: ArtDirective[] = faces.map((face, i) => {
    if (!face) return "keep_self";
    // "No art": drop any art and neither inherit nor generate. A null artUrl
    // tells the renderer to leave the frame blank.
    if (noArt) {
      face.artUrl = undefined;
      return "keep_self";
    }
    // Inherit the original art so unchanged faces render with it.
    if (!face.artUrl && typeof origFaces[i]?.artUrl === "string") {
      face.artUrl = origFaces[i]!.artUrl;
    }
    // Nothing to generate from without a description.
    if (!norm(face.artDescription)) return "keep_self";
    // Generate when the description changed, OR when the face still has no art
    // (e.g. re-enabling art after a no-art render left it blank) — there a
    // matching description must not block regeneration.
    const changed = norm(face.artDescription) !== norm(origFaces[i]?.artDescription);
    return changed || !face.artUrl ? "generate" : "keep_self";
  });

  const regen = directives.some((d) => d === "generate");
  console.log(`[Pipeline] field ${mode} ${cardId} (parent ${original.id})${regen ? " [art regen]" : ""}`);

  if (regen) {
    // Clear artUrl on the faces being regenerated so the generator fills them;
    // unchanged faces keep their inherited URL untouched.
    faces.forEach((face, i) => {
      if (face && directives[i] === "generate") face.artUrl = undefined;
    });
    // Collapse shared-art layouts (room, flip) before generating, mirroring the
    // LLM create path.
    combineSharedArtDescriptions(cardData);
    await generateArtForAllFaces(cardData, directives, original);
  }

  const [rendered, thumbnail] = await Promise.all([
    renderCardOnly(cardData),
    renderThumbnailOnly(cardData),
  ]);
  applyNormalizedFields(cardData, rendered.normalizedCardData as CardData);
  const pendingArtUploads = reserveArtUrls(cardData);

  return persistGeneratedCard({
    cardId,
    cardData,
    rendered,
    thumbnail,
    pendingArtUploads,
    prompt: original.prompt,
    creatorId,
    parentId: original.id,
    mode,
    createdDate: new Date().toISOString(),
  });
}

/** Manual create: build a brand-new card from form `cardData` with no LLM and
 *  no parent. Art is generated from each face's artDescription; faces with an
 *  empty description (or when `noArt` is set) render an empty/black frame. */
export async function createManualCard(
  cardData: CardData,
  creatorId: string,
  noArt = false,
): Promise<CardRecord> {
  const cardId = uuid();
  applyDesignerDefault(cardData);
  const norm = (s?: string) => (s ?? "").trim();

  const faces = [cardData, cardData.linkedCard];
  const directives: ArtDirective[] = faces.map((face) => {
    if (!face) return "keep_self";
    if (noArt || !norm(face.artDescription)) {
      face.artUrl = undefined;
      return "keep_self";
    }
    face.artist = ART_MODEL;
    return "generate";
  });

  const regen = directives.some((d) => d === "generate");
  console.log(`[Pipeline] manual create ${cardId}${noArt ? " [no art]" : ""}`);

  if (regen) {
    combineSharedArtDescriptions(cardData);
    await generateArtForAllFaces(cardData, directives, undefined);
  }

  const [rendered, thumbnail] = await Promise.all([
    renderCardOnly(cardData),
    renderThumbnailOnly(cardData),
  ]);
  applyNormalizedFields(cardData, rendered.normalizedCardData as CardData);
  const pendingArtUploads = reserveArtUrls(cardData);

  return persistGeneratedCard({
    cardId,
    cardData,
    rendered,
    thumbnail,
    pendingArtUploads,
    prompt: "",
    creatorId,
    parentId: undefined,
    mode: "create",
    createdDate: new Date().toISOString(),
  });
}

/** Phase 2: upload all art + rendered faces to S3, write CardRecord to DDB. */
export async function persistGeneratedCard(g: GeneratedCard): Promise<CardRecord> {
  const [renderedUrls, thumbnailUrls] = await Promise.all([
    uploadFaces(g.rendered),
    uploadThumbnailFaces(g.thumbnail),
    Promise.all(g.pendingArtUploads.map((p) => uploadBuffer(p.buffer, p.key, "image/png"))),
  ]);
  const record = buildCardRecord(g, renderedUrls, thumbnailUrls);
  await commitCard(record, g.mode === "edit" ? g.parentId : undefined);
  return record;
}
