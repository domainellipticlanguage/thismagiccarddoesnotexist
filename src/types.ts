import type { CardData, MtgCardDisplayData, Rotation } from "mtg-crucible";

// ---------------------------------------------------------------------------
// Art directive — per-face instruction to the art pipeline
// ---------------------------------------------------------------------------

export type ArtDirective =
  | "generate"       // generate new art from scratch
  | "keep_self"      // use this face's existing art unchanged
  | "keep_other"     // use the other face's existing art (swap case)
  | "edit_self"      // Flux Kontext tweak of this face's existing art
  | "edit_other";    // Flux Kontext tweak of the other face's art

/** A user-submitted rendering-bug report attached to a card. */
export interface BugReport {
  text: string;
  reportedAt: string;
}

/** Single DynamoDB row — one card. */
export interface CardRecord {
  id: string;
  cardData: CardData;
  renderedUrls: string[];
  /** Low-quality webp faces (front, optional back) used for fast gallery loads. */
  thumbnailUrls: string[];
  /** Constant partition key for the SequenceNumberIndex GSI (always 0) so the
   *  whole gallery lives in one partition and can be queried newest-first. */
  dummyHashKey: number;
  /** GSI sort key — epoch ms derived from createdDate. Pages the gallery. */
  sequenceNumber: number;
  crucibleText: string;
  scryfallText: string;
  scryfallJson: string;
  rotations: Rotation[];
  prompt: string;
  creatorId: string;
  parentId?: string;
  createdDate: string;
  isDeleted: boolean;
  isFinished: boolean;
  isSuperseded: boolean;
  /** Latest rendering-bug report, if any (overwritten on each submission). */
  bugReport?: BugReport;
}

/** API-facing card document (CardRecord + optional display data). */
export interface CardDocument extends CardRecord {
  display?: MtgCardDisplayData;
}

export interface CardResponse {
  card: CardDocument;
  canEdit: boolean;
  canDelete: boolean;
}

export interface CardsResponse {
  cards: CardDocument[];
  /** Opaque cursor for the next page; absent when the gallery is exhausted. */
  nextCursor?: string;
}

export interface CreateCardRequest {
  description: string;
  base?: string;
  mode: "create" | "edit" | "copy";
}

export interface LLMCardResponse {
  cardData: CardData;
  /** Per-face art directives, 1 entry for single-face, 2 for multi-face. */
  artDirectives: ArtDirective[];
}
