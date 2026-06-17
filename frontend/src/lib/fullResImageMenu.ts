import type { MtgCardMenuItem } from "mtg-crucible/react";
import type { Card } from "../types/card";

// The gallery renders a low-quality thumbnail (buildDisplay({ thumbnail: true }))
// for fast loads, so crucible's built-in Download/Copy menu items — which act on
// the displayed image URL — would hand back the thumbnail. We hide those built-ins
// and replace them with versions that act on the full-resolution renderedUrls.
// The card detail page needs none of this: it already displays full-res.

/** Built-in MtgCard menu item ids to hide in the gallery (they use the thumbnail). */
export const THUMBNAIL_IMAGE_MENU_IDS = ["download", "copy-image", "copy-image-url"];

const slugify = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

/** Full-resolution Download / Copy menu items, mirroring crucible's built-ins
 *  but sourced from card.renderedUrls instead of the displayed (thumbnail) image. */
export function fullResImageMenuItems(card: Card): MtgCardMenuItem[] {
  const front = card.renderedUrls?.[0];
  if (!front) return [];
  const back = card.renderedUrls[1];
  const name = card.cardData?.name || card.display?.name || "card";
  const backName = card.display?.backFaceName;

  return [
    {
      label: "Download Image",
      action: () => {
        const download = (src: string, n: string) => {
          const ext = src.startsWith("data:image/jpeg") ? "jpg" : "png";
          const a = document.createElement("a");
          a.href = src;
          a.download = `${slugify(n)}.${ext}`;
          a.click();
        };
        // Single-image multi-face cards (split/fuse/aftermath/adventure) have one
        // render but a back-face name — use a combined "front--back" filename.
        const singleImageMultiFace = !back && !!backName;
        download(front, singleImageMultiFace ? `${name}--${backName}` : name);
        if (back && backName) download(back, backName);
      },
    },
    {
      label: "Copy Card Image",
      action: async () => {
        try {
          // Clipboard API requires image/png — convert the webp render via canvas.
          // crossOrigin keeps the canvas untainted (the asset bucket sets CORS).
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.src = front;
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
          });
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          canvas.getContext("2d")!.drawImage(img, 0, 0);
          const blob = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"),
          );
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        } catch {
          // Some browsers don't support clipboard image writes.
        }
      },
    },
    {
      label: "Copy Image URL",
      action: () => {
        navigator.clipboard.writeText(front);
      },
    },
  ];
}
