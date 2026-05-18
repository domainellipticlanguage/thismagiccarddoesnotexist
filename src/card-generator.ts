import { v4 as uuid } from "uuid";
import type { CardDocument, CardRecord, ArtDirective } from "./types.js";
import type { CardData, RenderedCard } from "mtg-crucible";
import { createCard as llmCreateCard } from "./llm-client.js";
import { generateArt, editArt } from "./art-generator.js";
import {
  getArtDimensions,
  normalizeCard,
  renderCardOnly,
  uploadFaces,
} from "./card-renderer.js";
import {
  getCard,
  commitCard,
} from "./card-table.js";
import { uploadBuffer, getPublicUrl } from "./s3-storage.js";

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
  pendingArtUploads: { buffer: Buffer; key: string }[];
  prompt: string;
  creatorId: string;
  parentId?: string;
  mode: "create" | "edit" | "copy";
  createdDate: string;
}

/** Build a CardRecord from a GeneratedCard plus a renderedUrls array (S3 URLs or data URLs). */
export function buildCardRecord(g: GeneratedCard, renderedUrls: string[]): CardRecord {
  return {
    id: g.cardId,
    cardData: g.cardData,
    renderedUrls,
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
  cardData.artist = "prunaai/p-image";
  cardData.designer = "thismagiccarddoesnotexist.com";
  if (cardData.linkedCard) {
    cardData.linkedCard.artist = "prunaai/p-image";
    cardData.linkedCard.designer = "thismagiccarddoesnotexist.com";
  }
  console.log(`[Pipeline] Card: ${cardData.name} | directives: ${llmResult.artDirectives.join(",")}`);

  // Layouts that share one art across two faces (rooms, flip): collapse the
  // LLM's two per-face descriptions into one composite before art gen +
  // persistence. Mutates cardData in place.
  combineSharedArtDescriptions(cardData);

  await generateArtForAllFaces(cardData, llmResult.artDirectives, originalCard);

  const rendered = await renderCardOnly(cardData);
  applyNormalizedFields(cardData, rendered.normalizedCardData as CardData);

  // Renderer is done with the Buffer artUrls; swap each Buffer for its
  // future S3 URL on cardData so the response (and DDB record) carries
  // proper string URLs. The bytes are queued for the persist phase.
  const pendingArtUploads = reserveArtUrls(cardData);

  return {
    cardId,
    cardData,
    rendered,
    pendingArtUploads,
    prompt: description,
    creatorId,
    parentId: originalCardId,
    mode,
    createdDate: new Date().toISOString(),
  };
}

/** Advanced edit: re-render `cardData` against an existing card (no LLM, no new art). */
export async function applyFieldEdits(
  cardData: CardData,
  original: CardDocument,
  creatorId: string,
): Promise<CardRecord> {
  const cardId = uuid();
  console.log(`[Pipeline] field edit ${cardId} (parent ${original.id})`);

  // The form may not re-emit artUrl per face — inherit from the original
  // so the renderer has art to draw with.
  if (!cardData.artUrl && typeof original.cardData.artUrl === "string") {
    cardData.artUrl = original.cardData.artUrl;
  }
  if (
    cardData.linkedCard &&
    !cardData.linkedCard.artUrl &&
    typeof original.cardData.linkedCard?.artUrl === "string"
  ) {
    cardData.linkedCard.artUrl = original.cardData.linkedCard.artUrl;
  }

  const rendered = await renderCardOnly(cardData);
  applyNormalizedFields(cardData, rendered.normalizedCardData as CardData);
  const pendingArtUploads = reserveArtUrls(cardData);

  return persistGeneratedCard({
    cardId,
    cardData,
    rendered,
    pendingArtUploads,
    prompt: original.prompt,
    creatorId,
    parentId: original.id,
    mode: "edit",
    createdDate: new Date().toISOString(),
  });
}

/** Phase 2: upload all art + rendered faces to S3, write CardRecord to DDB. */
export async function persistGeneratedCard(g: GeneratedCard): Promise<CardRecord> {
  const [renderedUrls] = await Promise.all([
    uploadFaces(g.rendered),
    Promise.all(g.pendingArtUploads.map((p) => uploadBuffer(p.buffer, p.key, "image/png"))),
  ]);
  const record = buildCardRecord(g, renderedUrls);
  await commitCard(record, g.mode === "edit" ? g.parentId : undefined);
  return record;
}
