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

/** Single DynamoDB row — one card. */
export interface CardRecord {
  id: string;
  cardData: CardData;
  renderedUrls: string[];
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
