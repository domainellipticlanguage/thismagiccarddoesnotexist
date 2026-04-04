import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { fetchCard, createCard } from "../api/client";
import type { Card } from "../types/card";
import { MtgCard } from "@domainellipticlanguage/mtg-crucible/react";
import { CreateForm } from "../components/CreateForm";
import { LoadingSpinner } from "../components/LoadingSpinner";

export function EditPage({ mode: propMode }: { mode?: "edit" | "copy" }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const mode = propMode || "edit";
  const [card, setCard] = useState<Card | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetchCard(id).then((data) => setCard(data.card)).catch((err) => setError(err.message)).finally(() => setLoading(false));
  }, [id]);

  async function handleAIEdit(description: string) {
    if (!id) return;
    setSaving(true); setError(null);
    try { navigate(`/card/${await createCard(description, id, mode)}`); }
    catch (err: any) { setError(err.message); setSaving(false); }
  }

  if (loading) return <LoadingSpinner fullScreen />;
  if (!card) return <div className="text-center text-red-400 py-16"><p>{error || "Card not found"}</p></div>;

  const title = mode === "copy" ? `Remix: ${card.cardData?.name || "Card"}` : `Edit: ${card.cardData?.name || "Card"}`;

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="font-display text-2xl text-gold-400 mb-6">{title}</h1>
      {saving ? (
        <LoadingSpinner fullScreen message={mode === "copy" ? "Creating remix..." : "AI is editing your card..."} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1">
            {card.display && <MtgCard card={card.display} style={{ width: "100%" }} />}
          </div>
          <div className="lg:col-span-2">
            {error && <div className="mb-4 p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-300 text-sm">{error}</div>}
            <p className="text-sm text-neutral-400 mb-4">
              {mode === "copy" ? "Describe how you want to remix this card." : "Describe the changes you want to make."}
            </p>
            <CreateForm onSubmit={handleAIEdit} loading={saving} />
          </div>
        </div>
      )}
    </div>
  );
}
