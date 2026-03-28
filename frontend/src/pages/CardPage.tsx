import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { fetchCard } from "../api/client";
import type { Card } from "../types/card";
import { CardView } from "../components/CardView";
import { LoadingSpinner } from "../components/LoadingSpinner";

export function CardPage() {
  const { id } = useParams<{ id: string }>();
  const [card, setCard] = useState<Card | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetchCard(id)
      .then((data) => {
        setCard(data.card);
        setCanEdit(data.canEdit);
        setCanDelete(data.canDelete);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <LoadingSpinner fullScreen />;
  if (error || !card) return <div className="text-center text-red-400 py-16"><p>{error || "Card not found"}</p></div>;
  return <CardView card={card} canEdit={canEdit} canDelete={canDelete} />;
}
