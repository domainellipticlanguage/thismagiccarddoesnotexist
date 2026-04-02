import type { CardData, MtgCardDisplayData, Rotation } from "@domainellipticlanguage/mtg-crucible";

// ---------------------------------------------------------------------------
// Art directives — per-face art generation instructions
// ---------------------------------------------------------------------------

/** Which existing face's art to reference. Always from the original (pre-edit) card. */
export type ArtReference = "primary_old" | "secondary_old";

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
  artDirectives?: ArtDirectives;
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
  artDirectives?: ArtDirectives;
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
  art_directives?: ArtDirectives;
}
