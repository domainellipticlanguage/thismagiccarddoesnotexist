import { Link } from "react-router-dom";
import type { Card } from "../types/card";

export function CardThumbnail({ card }: { card: Card }) {
  const name = card.cardData?.name || "Untitled";
  return (
    <Link
      to={`/card/${card.id}`}
      className="group block rounded-lg overflow-hidden bg-neutral-900 border border-neutral-800 hover:border-gold-500/50 transition-all hover:shadow-lg hover:shadow-gold-500/10"
    >
      {card.renderedUrl ? (
        <img src={card.renderedUrl} alt={name} className="w-full aspect-[5/7] object-cover group-hover:scale-[1.02] transition-transform" loading="lazy" />
      ) : (
        <div className="w-full aspect-[5/7] bg-neutral-800 flex items-center justify-center">
          <span className="text-neutral-500 text-sm">{name}</span>
        </div>
      )}
    </Link>
  );
}
