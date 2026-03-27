import type { CardData, RenderedCardDisplay } from "@domainellipticlanguage/mtg-crucible";

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
  artUrl: string;
  renderedUrl: string;
  creatorId: string;
  parentId?: string;
  sequenceNumber: number;
  createdDate: string;
  isDeleted: boolean;
  isFinished: boolean;
  isSuperseded: boolean;
}

export interface CardResponse {
  card: Card;
  canEdit: boolean;
  canDelete: boolean;
  display?: RenderedCardDisplay;
}

export const CARD_TYPES = [
  "artifact", "creature", "land", "instant", "sorcery",
  "enchantment", "planeswalker", "battle",
] as const;

export const RARITIES = ["common", "uncommon", "rare", "mythic"] as const;

export const TEMPLATE_NAMES = [
  "standard", "planeswalker", "planeswalker_tall", "saga", "class", "battle",
  "adventure", "transform_front", "transform_back", "mdfc_front", "mdfc_back",
  "split", "flip", "mutate", "prototype", "leveler", "fuse", "aftermath",
] as const;

export const FRAME_COLORS = [
  "white", "blue", "black", "red", "green",
  "colorless", "artifact", "multicolor", "vehicle", "land",
] as const;

export const FRAME_EFFECTS = ["normal", "nyx", "snow", "devoid", "miracle"] as const;
