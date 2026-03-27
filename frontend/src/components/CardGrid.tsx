import type { Card } from "../types/card";
import { CardThumbnail } from "./CardThumbnail";

export function CardGrid({ cards }: { cards: Card[] }) {
  if (cards.length === 0) {
    return (
      <div className="text-center text-neutral-500 py-16">
        <p className="text-lg">No cards yet</p>
        <p className="text-sm mt-1">Create your first card to get started!</p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
      {cards.map((card) => <CardThumbnail key={card.id} card={card} />)}
    </div>
  );
}
