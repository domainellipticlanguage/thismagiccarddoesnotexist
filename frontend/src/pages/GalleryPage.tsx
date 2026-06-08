import { useState, useEffect, useCallback } from "react";
import { fetchCardsPage } from "../api/client";
import type { Card } from "../types/card";
import { CardGrid } from "../components/CardGrid";
import { LoadingSpinner } from "../components/LoadingSpinner";

export function GalleryPage() {
  const [cards, setCards] = useState<Card[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const page = await fetchCardsPage(cursor);
      setCards((prev) => [...prev, ...page.cards]);
      setCursor(page.nextCursor);
      setHasMore(Boolean(page.nextCursor));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }, [cursor]);

  useEffect(() => {
    fetchCardsPage()
      .then((page) => {
        setCards(page.cards);
        setCursor(page.nextCursor);
        setHasMore(Boolean(page.nextCursor));
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner fullScreen message="Loading gallery..." />;
  if (error) return <div className="text-center text-red-400 py-16"><p>Failed to load cards: {error}</p></div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="font-display text-2xl text-gold-400">Gallery</h1>
        <span className="text-sm text-neutral-500">{cards.length} cards{hasMore ? "+" : ""}</span>
      </div>
      <CardGrid cards={cards} />
      {hasMore && (
        <div className="flex justify-center mt-8">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="px-6 py-2 rounded-lg border border-gold-400/40 text-gold-400 hover:bg-gold-400/10 disabled:opacity-50 transition-colors"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
