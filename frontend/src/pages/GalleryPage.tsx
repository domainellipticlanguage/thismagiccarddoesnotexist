import { useState, useEffect } from "react";
import { fetchCards } from "../api/client";
import type { Card } from "../types/card";
import { CardGrid } from "../components/CardGrid";
import { LoadingSpinner } from "../components/LoadingSpinner";

export function GalleryPage() {
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCards().then(setCards).catch((err) => setError(err.message)).finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner fullScreen message="Loading gallery..." />;
  if (error) return <div className="text-center text-red-400 py-16"><p>Failed to load cards: {error}</p></div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="font-display text-2xl text-gold-400">Gallery</h1>
        <span className="text-sm text-neutral-500">{cards.length} cards</span>
      </div>
      <CardGrid cards={cards} />
    </div>
  );
}
