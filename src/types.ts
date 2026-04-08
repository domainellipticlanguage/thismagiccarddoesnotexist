import type { CardData, MtgCardDisplayData, Rotation } from "mtg-crucible";

// ---------------------------------------------------------------------------
// Art edit mode — MVP: single-face, simple keep/edit/regenerate
// ---------------------------------------------------------------------------

export type ArtEditMode = "keep" | "edit" | "regenerate";

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
  explanation: string;
  llmCardData?: CardData;
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
  explanation: string;
  artEditMode?: ArtEditMode;
}
