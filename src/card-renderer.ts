import {
  parseCard,
  renderCard,
  formatCard,
  getArtDimensions,
  toDisplayCard,
} from "@domainellipticlanguage/mtg-crucible";
import type {
  CardData,
  RenderedCard,
  RenderedCardDisplay,
} from "@domainellipticlanguage/mtg-crucible";
import { v4 as uuid } from "uuid";
import { uploadBuffer, getPresignedUrl } from "./s3-storage.js";

export { parseCard, formatCard, getArtDimensions, toDisplayCard };
export type { CardData, RenderedCard, RenderedCardDisplay };

export function getArtDimensionsFromText(crucibleText: string): {
  width: number;
  height: number;
  cardData: CardData;
} {
  const cardData = parseCard(crucibleText);
  const dims = getArtDimensions(cardData);
  return { width: dims.width, height: dims.height, cardData };
}

/** Render a full card (all faces) and upload each face to S3.
 *  Returns the RenderedCard and an array of S3 URIs (one per face). */
export async function renderAndUpload(cardData: CardData): Promise<{
  rendered: RenderedCard;
  renderedS3Uris: string[];
}> {
  console.log(`[Render] Rendering: ${cardData.name || "Untitled"}`);
  const start = Date.now();
  const rendered = await renderCard(cardData);
  console.log(`[Render] Done in ${((Date.now() - start) / 1000).toFixed(2)}s`);

  const uris: string[] = [];

  // Front face
  const frontKey = `rendered/${uuid()}.png`;
  uris.push(await uploadBuffer(rendered.frontFace, frontKey));

  // Back face if present
  if (rendered.backFace) {
    const backKey = `rendered/${uuid()}-back.png`;
    uris.push(await uploadBuffer(rendered.backFace, backKey));
  }

  return { rendered, renderedS3Uris: uris };
}

/** Build a RenderedCardDisplay with presigned S3 URLs. */
export async function buildDisplay(
  renderedS3Uris: string[],
  rendered?: RenderedCard
): Promise<RenderedCardDisplay | undefined> {
  if (!renderedS3Uris.length || !renderedS3Uris[0]) return undefined;

  const frontFace = await getPresignedUrl(renderedS3Uris[0]);
  const backFace =
    renderedS3Uris.length > 1 ? await getPresignedUrl(renderedS3Uris[1]) : undefined;

  return {
    frontFace,
    frontFaceOrientation: rendered?.frontFaceOrientation || "vertical",
    backFace,
    backFaceOrientation: backFace
      ? rendered?.backFaceOrientation || "vertical"
      : undefined,
    name: rendered?.normalizedCardData?.name || "",
    rotations: rendered?.rotations || [],
    scryfallJson: rendered?.scryfallJson || "",
    scryfallText: rendered?.scryfallText || "",
    crucibleText: rendered?.crucibleText || "",
  };
}
