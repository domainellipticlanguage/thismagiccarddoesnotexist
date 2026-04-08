import { Link } from "react-router-dom";
import { MtgCard } from "mtg-crucible/react";
import type { Card } from "../types/card";

export function CardThumbnail({ card }: { card: Card }) {
  return (
    <Link
      to={`/card/${card.id}`}
      className="group block rounded-lg overflow-hidden bg-neutral-900 border border-neutral-800 hover:border-gold-500/50 transition-all hover:shadow-lg hover:shadow-gold-500/10"
    >
      {card.display ? (
        <MtgCard card={card.display} cardText={card.scryfallText} style={{ width: "100%" }} />
      ) : (
        <div className="w-full aspect-[5/7] bg-neutral-800 flex items-center justify-center">
          <span className="text-neutral-500 text-sm">{card.cardData?.name || "Untitled"}</span>
        </div>
      )}
    </Link>
  );
}
