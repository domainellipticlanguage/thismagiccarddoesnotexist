import { v4 as uuid } from "uuid";
import type { CardDocument, CardRecord, ArtDirective } from "./types.js";
import type { CardData, RenderedCard } from "mtg-crucible";
import { createCard as llmCreateCard } from "./llm-client.js";
import { generateArt, editArt, ART_CREDIT } from "./art-generator.js";
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
import { stripSiteCredit } from "./designer-credit.js";

/** Store the bare user-supplied designer on every face (designer is card-level).
 *  The site credit is NOT stored here — it's implied and gets appended only on
 *  the rendered image (see card-renderer). Any legacy trailing site credit is
 *  stripped so it never leaks into the record or card text. */
function applyDesigner(cardData: CardData, raw: string | undefined): void {
  const designer = stripSiteCredit(raw) || undefined;
  cardData.designer = designer;
  if (cardData.linkedCard) cardData.linkedCard.designer = designer;
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
  // linkType is intentionally NOT persisted — it's derived data that crucible
  // re-infers at render time. We keep it on cardData only when the manual form
  // sets it as an explicit layout override; otherwise it stays undefined ("Auto").
}

/** Drop colorIndicators that carry no information. A colorIndicator only matters
 *  on a face whose color can't be derived from a mana cost; if a face HAS a mana
 *  cost, its colors come from that cost and any colorIndicator is redundant, so
 *  strip it. Kamigawa flip backs are the exception that proves the rule: they
 *  have no mana cost of their own yet still inherit the front face's colors, so
 *  they must never carry an indicator either. Applied to every face on every
 *  pipeline (LLM create/edit, manual create, field edits) before rendering. */
function stripRedundantColorIndicators(cardData: CardData): void {
  for (const face of [cardData, cardData.linkedCard]) {
    if (face?.manaCost && face.colorIndicator) face.colorIndicator = undefined;
  }
  if (cardData.linkedCard && normalizeCard(cardData).linkType === "flip") {
    cardData.linkedCard.colorIndicator = undefined;
  }
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
  // The creator's remembered Designer (from their cookie); used on create.
  designerCookie?: string,
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
  cardData.artist = ART_CREDIT;
  if (cardData.linkedCard) cardData.linkedCard.artist = ART_CREDIT;
  // Designer is card-level: AI edits inherit the original card's designer
  // (recomposed with the site credit); a fresh create falls back to the
  // creator's remembered Designer cookie, then to just the site.
  applyDesigner(cardData, originalCard?.cardData?.designer ?? designerCookie);
  console.log(`[Pipeline] Card: ${cardData.name} | directives: ${llmResult.artDirectives.join(",")}`);

  // Layouts that share one art across two faces (rooms, flip): collapse the
  // LLM's two per-face descriptions into one composite before art gen +
  // persistence. Mutates cardData in place.
  combineSharedArtDescriptions(cardData);

  await generateArtForAllFaces(cardData, llmResult.artDirectives, originalCard);

  stripRedundantColorIndicators(cardData);

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
): Promise<CardRecord> {
  const cardId = uuid();

  // Manual edits carry the raw card-level Designer from the form; compose it
  // with the site credit (or just the site when left blank).
  applyDesigner(cardData, cardData.designer);

  // The art description is the control: an empty one means "no art" (blank
  // frame). A non-empty description keeps the existing image, or regenerates it
  // when the description changed or the face currently has no art. The form
  // preserves artUrl from the original (it only edits text fields).
  const faces = [cardData, cardData.linkedCard];
  const origFaces = [original.cardData, original.cardData.linkedCard];
  const norm = (s?: string) => (s ?? "").trim();

  const directives: ArtDirective[] = faces.map((face, i) => {
    if (!face) return "keep_self";
    // No description = no art; cleared after generation (see below).
    if (!norm(face.artDescription)) return "keep_self";
    // Inherit the original art so an unchanged face keeps its image.
    if (!face.artUrl && typeof origFaces[i]?.artUrl === "string") {
      face.artUrl = origFaces[i]!.artUrl;
    }
    // Generate when the description changed, OR when the face still has no art
    // (e.g. art was previously blank) — a matching description must not block it.
    const changed = norm(face.artDescription) !== norm(origFaces[i]?.artDescription);
    return changed || !face.artUrl ? "generate" : "keep_self";
  });

  const regen = directives.some((d) => d === "generate");
  console.log(`[Pipeline] field ${mode} ${cardId} (parent ${original.id})${regen ? " [art regen]" : ""}`);

  if (regen) {
    // Clear artUrl on the faces being regenerated so the generator fills them
    // (and stamp the AI artist credit); unchanged faces keep their inherited URL.
    faces.forEach((face, i) => {
      if (face && directives[i] === "generate") {
        face.artUrl = undefined;
        face.artist = ART_CREDIT;
      }
    });
    // Collapse shared-art layouts (room, flip) before generating, mirroring the
    // LLM create path.
    combineSharedArtDescriptions(cardData);
    await generateArtForAllFaces(cardData, directives, original);
  }

  // Faces with no description render blank. Clear any art still attached —
  // whether the form sent the inherited URL, or generateArtForAllFaces
  // re-inherited it via keep_self while another face was regenerating.
  faces.forEach((face) => {
    if (face && !norm(face.artDescription)) face.artUrl = undefined;
  });

  stripRedundantColorIndicators(cardData);

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
 *  no parent. Art is generated from each face's artDescription; a face with an
 *  empty description renders an empty/black frame. */
export async function createManualCard(
  cardData: CardData,
  creatorId: string,
): Promise<CardRecord> {
  const cardId = uuid();
  applyDesigner(cardData, cardData.designer);
  const norm = (s?: string) => (s ?? "").trim();

  const faces = [cardData, cardData.linkedCard];
  const directives: ArtDirective[] = faces.map((face) => {
    if (!face) return "keep_self";
    if (!norm(face.artDescription)) {
      face.artUrl = undefined;
      return "keep_self";
    }
    face.artist = ART_CREDIT;
    return "generate";
  });

  const regen = directives.some((d) => d === "generate");
  console.log(`[Pipeline] manual create ${cardId}`);

  if (regen) {
    combineSharedArtDescriptions(cardData);
    await generateArtForAllFaces(cardData, directives, undefined);
  }

  stripRedundantColorIndicators(cardData);

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
