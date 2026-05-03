import { useState, useEffect } from "react";
import { useParams, useLocation } from "react-router-dom";
import { fetchCard } from "../api/client";
import type { Card, CardResponse } from "../types/card";
import { CardView } from "../components/CardView";
import { LoadingSpinner } from "../components/LoadingSpinner";

export function CardPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  // After create/edit we navigate here with the full CardResponse in
  // router state — use it directly instead of round-tripping to /api/cards/:id.
  const initial = (location.state as CardResponse | null) ?? null;
  const [card, setCard] = useState<Card | null>(initial?.card ?? null);
  const [canEdit, setCanEdit] = useState(initial?.canEdit ?? false);
  const [canDelete, setCanDelete] = useState(initial?.canDelete ?? false);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id || initial) return;
    fetchCard(id)
      .then((data) => {
        setCard(data.card);
        setCanEdit(data.canEdit);
        setCanDelete(data.canDelete);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id, initial]);

  if (loading) return <LoadingSpinner fullScreen />;
  if (error || !card) return <div className="text-center text-red-400 py-16"><p>{error || "Card not found"}</p></div>;
  return <CardView card={card} canEdit={canEdit} canDelete={canDelete} />;
}
