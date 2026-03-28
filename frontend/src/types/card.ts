// Re-export constant arrays and types from crucible (browser-safe constants sub-module)
import type { CardData, MtgCardDisplayData } from "@domainellipticlanguage/mtg-crucible/constants";
export type { CardData, MtgCardDisplayData };

export {
  CARD_TYPES,
  RARITIES,
  TEMPLATE_NAMES,
  FRAME_COLORS,
  FRAME_EFFECTS,
  LINK_TYPES,
  COLORS,
  SUPERTYPES_LIST,
} from "@domainellipticlanguage/mtg-crucible/constants";

export interface Card {
  id: string;
  crucibleText: string;
  cardData: CardData;
  scryfallText: string;
  prompt: string;
  explanation: string;
  suggestionArtwork: string;
  suggestionMechanics: string;
  artEditMode?: string;
  renderedUrls: string[];
  display?: MtgCardDisplayData;
  creatorId: string;
  parentId?: string;
  createdDate: string;
  isDeleted: boolean;
  isFinished: boolean;
  isSuperseded: boolean;
}

export interface CardResponse {
  card: Card;
  canEdit: boolean;
  canDelete: boolean;
}
