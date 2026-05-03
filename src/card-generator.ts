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
      if (otherOriginalUrl) return otherOriginalUrl;
      return desc ? generateArt(desc, width, height) : undefined;
    case "edit_self":
      return selfOriginalUrl && desc
        ? editArt(desc, selfOriginalUrl, width, height)
        : desc ? generateArt(desc, width, height) : undefined;
    case "edit_other": {
      const src = otherNew ?? otherOriginalUrl;
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
  // crucible 0.3.5 widened artUrl to string | Buffer; we only ever store string URLs in DDB.
  const origUrls = originalFaces.map((f) => (typeof f?.artUrl === "string" ? f.artUrl : undefined));
  const directives = faces.map((_, i) => artDirectives[i] ?? "generate");

  const newArt: (string | Buffer | undefined)[] = new Array(faces.length).fill(undefined);

  // Pass 1: resolve faces that don't depend on the other face's new art.
  await Promise.all(
    faces.map(async (face, i) => {
      if (directives[i] === "edit_other") return;
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

  // Pass 2: resolve edit_other faces (can now reference the other face's new art).
  for (let i = 0; i < faces.length; i++) {
    if (directives[i] !== "edit_other") continue;
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

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  const result = await fn();
  console.log(`[Pipeline] phase ${label}: ${((Date.now() - start) / 1000).toFixed(2)}s`);
  return result;
}

/** Phase 1: LLM, art, render. Returns image buffers — no S3, no DDB. */
export async function generateRenderedCard(
  description: string,
  originalCardId: string | undefined,
  creatorId: string,
  mode: "create" | "edit" | "copy",
): Promise<GeneratedCard> {
  const cardId = uuid();
  const totalStart = Date.now();
  console.log(`[Pipeline] ${mode} card ${cardId}`);

  let originalCard: CardDocument | undefined;
  let originalCrucibleText: string | undefined;
  if (originalCardId && (mode === "edit" || mode === "copy")) {
    originalCard = await getCard(originalCardId);
    if (!originalCard) throw new Error(`Original card ${originalCardId} not found`);
    originalCrucibleText = originalCard.crucibleText;
  }

  const llmResult = await timed("LLM", () =>
    llmCreateCard(description, originalCrucibleText, mode)
  );

  const cardData = llmResult.cardData;
  cardData.artist = "prunaai/p-image";
  cardData.designer = "thismagiccarddoesnotexist.com";
  if (cardData.linkedCard) {
    cardData.linkedCard.artist = "prunaai/p-image";
    cardData.linkedCard.designer = "thismagiccarddoesnotexist.com";
  }
  console.log(`[Pipeline] Card: ${cardData.name} | art directives: ${llmResult.artDirectives.join(",")}`);

  await timed("Art", () =>
    generateArtForAllFaces(cardData, llmResult.artDirectives, originalCard)
  );

  const rendered = await timed("Render", () => renderCardOnly(cardData));
  applyNormalizedFields(cardData, rendered.normalizedCardData as CardData);

  // Renderer is done with the Buffer artUrls; swap each Buffer for its
  // future S3 URL on cardData so the response (and DDB record) carries
  // proper string URLs. The bytes are queued for the persist phase.
  const pendingArtUploads = reserveArtUrls(cardData);

  console.log(`[Pipeline] Generated in ${((Date.now() - totalStart) / 1000).toFixed(2)}s`);

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

/** Phase 2: upload all art + rendered faces to S3, write CardRecord to DDB. */
export async function persistGeneratedCard(g: GeneratedCard): Promise<CardRecord> {
  const start = Date.now();
  const [renderedUrls] = await Promise.all([
    timed("S3 upload (rendered faces)", () => uploadFaces(g.rendered)),
    timed("S3 upload (art)", () =>
      Promise.all(g.pendingArtUploads.map((p) => uploadBuffer(p.buffer, p.key, "image/png")))
    ),
  ]);
  const record = buildCardRecord(g, renderedUrls);
  await timed("DDB commit", () =>
    commitCard(record, g.mode === "edit" ? g.parentId : undefined)
  );
  console.log(`[Pipeline] Persisted in ${((Date.now() - start) / 1000).toFixed(2)}s: ${g.cardId}`);
  return record;
}
