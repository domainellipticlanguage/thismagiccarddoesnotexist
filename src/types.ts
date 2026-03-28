import type { CardData, RenderedCardDisplay } from "@domainellipticlanguage/mtg-crucible";

export interface CardRecord {
  id: string;
  crucibleText: string;
  cardData: CardData;
  scryfallText: string;
  prompt: string;
  explanation: string;
  suggestionArtwork: string;
  suggestionMechanics: string;
  artEditMode?: string;
  artS3Uri: string;
  frontS3Uri: string;
  backS3Uri?: string;
  creatorId: string;
  parentId?: string;
  sequenceNumber: number;
  dummyHashKey: number;
  createdDate: string;
  isDeleted: boolean;
  isFinished: boolean;
  isSuperseded: boolean;
}

export interface CardResponse {
  card: CardRecord;
  canEdit: boolean;
  canDelete: boolean;
}

export interface CardsResponse {
  cards: CardRecord[];
}

export interface CreateCardRequest {
  description: string;
  base?: string;
  mode: "create" | "edit" | "copy";
}

export interface EditCardFieldsRequest {
  crucibleText: string;
}

export interface LLMCardResponse {
  card_text: string;
  explanation: string;
  suggestion_artwork: string;
  suggestion_mechanics: string;
  art_edit_mode?: "keep" | "edit" | "regenerate";
}
