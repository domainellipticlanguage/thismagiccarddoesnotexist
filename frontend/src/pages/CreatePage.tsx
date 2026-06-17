import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { createCard, createManualCard, fetchCard } from "../api/client";
import type { CardData } from "../types/card";
import { CreateForm } from "../components/CreateForm";
import { CardEditForm } from "../components/CardEditForm";
import { LoadingSpinner } from "../components/LoadingSpinner";

// A blank card for the manual-create form — every field starts empty.
const BLANK_CARD = {} as CardData;

export function CreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const baseId = searchParams.get("base");
  const mode = (searchParams.get("mode") as "create" | "copy") || "create";

  async function handleCreate(description: string) {
    setLoading(true);
    setError(null);
    try {
      const response = await createCard(description, baseId, mode);
      navigate(`/card/${response.card.id}/edit`, { state: response });
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  }

  async function handleManualCreate(cardData: CardData, noArt: boolean) {
    setLoading(true);
    setError(null);
    try {
      const newId = await createManualCard(cardData, noArt);
      const data = await fetchCard(newId);
      navigate(`/card/${newId}/edit?type=manual`, { state: data });
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6 gap-4">
        <h1 className="font-display text-2xl text-gold-400">{mode === "copy" ? "Remix Card" : "Create a Card"}</h1>
        {manual && (
          <button onClick={() => setManual(false)} disabled={loading} className="text-sm text-neutral-400 hover:text-gold-400 transition-colors">
            ← AI Create
          </button>
        )}
      </div>
      {error && <div className="mb-4 p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-300 text-sm">{error}</div>}
      {loading && <LoadingSpinner message={manual ? "Building your card... this can take a few seconds" : "Generating your card... this takes about 5-10 seconds"} />}
      <div className={loading ? "hidden" : ""}>
        {manual ? (
          <CardEditForm initialCardData={BLANK_CARD} onSave={handleManualCreate} loading={loading} submitLabel="Create Card" alwaysShowSubmit />
        ) : (
          <CreateForm onSubmit={handleCreate} loading={loading} onManual={() => setManual(true)} />
        )}
      </div>
    </div>
  );
}
