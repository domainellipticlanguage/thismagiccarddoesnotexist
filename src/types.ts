import type { CardData, MtgCardDisplayData, Rotation } from "@domainellipticlanguage/mtg-crucible";

// ---------------------------------------------------------------------------
// Art directives — per-face art generation instructions
// ---------------------------------------------------------------------------

/** Which art to reference: _old = from the original card, _new = from the newly generated face. */
export type ArtReference = "primary_old" | "secondary_old" | "primary_new" | "secondary_new";

/** How to generate art for a face. */
export type FaceArtMode = "no_edit" | "fine_grained_edit" | "coarse_grained_edit";

/** Art instruction for a single face. */
export interface FaceArtDirective {
  mode: FaceArtMode;
  /** Required for no_edit/fine_grained_edit. Ignored for coarse_grained_edit. Defaults to primary_old if omitted. */
  reference?: ArtReference;
}

/** Per-face art directives. */
export interface ArtDirectives {
  primary: FaceArtDirective;
  secondary?: FaceArtDirective;
}

/** Single DynamoDB row — one card (all faces in cardData.linkedCard chain). */
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
  suggestionArtwork: string;
  suggestionMechanics: string;
  artDirectives?: ArtDirectives;
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

export interface EditCardFieldsRequest {
  crucibleText?: string;
  cardData?: CardData;
}

export interface LLMCardResponse {
  cardData: CardData;
  explanation: string;
  suggestion_artwork: string;
  suggestion_mechanics: string;
  art_directives?: ArtDirectives;
}
