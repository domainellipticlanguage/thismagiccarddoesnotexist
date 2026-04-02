import type { CardData, MtgCardDisplayData, Rotation } from "@domainellipticlanguage/mtg-crucible";

/** A single row in DynamoDB — one face/sub-card of a card. */
export interface CardRow {
  id: string;
  subCardIndex: number;
  cardData: CardData;
  renderedUrl: string;

  // Only on subCardIndex 0:
  crucibleText?: string;
  scryfallText?: string;
  scryfallJson?: string;
  rotations?: Rotation[];
  prompt?: string;
  explanation?: string;
  suggestionArtwork?: string;
  suggestionMechanics?: string;
  artEditMode?: string;
  creatorId?: string;
  parentId?: string;
  createdDate?: string;
  isDeleted?: boolean;
  isFinished?: boolean;
  isSuperseded?: boolean;
}

/** Assembled card with all faces, ready for API response. */
export interface CardDocument {
  id: string;
  cardData: CardData;
  crucibleText: string;
  scryfallText: string;
  scryfallJson: string;
  rotations: Rotation[];
  prompt: string;
  explanation: string;
  suggestionArtwork: string;
  suggestionMechanics: string;
  artEditMode?: string;
  creatorId: string;
  parentId?: string;
  createdDate: string;
  isDeleted: boolean;
  isFinished: boolean;
  isSuperseded: boolean;
  display?: MtgCardDisplayData;
  renderedUrls: string[];
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

export interface EditCardFieldsRequest {
  crucibleText?: string;
  cardData?: CardData;
}

export interface LLMCardResponse {
  cardData: CardData;
  explanation: string;
  suggestion_artwork: string;
  suggestion_mechanics: string;
  art_edit_mode?: "keep" | "edit" | "regenerate";
}
