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
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const baseId = searchParams.get("base");
  const mode = (searchParams.get("mode") as "create" | "copy") || "create";
  // AI vs Manual, mirroring the Edit page's ?type=manual toggle.
  const createMode: "ai" | "manual" = searchParams.get("type") === "manual" ? "manual" : "ai";
  const setCreateMode = (next: "ai" | "manual") => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next === "ai") params.delete("type");
      else params.set("type", next);
      return params;
    }, { replace: true });
  };

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

  async function handleManualCreate(cardData: CardData) {
    setLoading(true);
    setError(null);
    try {
      const newId = await createManualCard(cardData);
      const data = await fetchCard(newId);
      navigate(`/card/${newId}/edit?type=manual`, { state: data });
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  }

  const verb = mode === "copy" ? "Remix" : "Create";

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6 gap-4">
        <h1 className="font-display text-2xl text-gold-400">{mode === "copy" ? "Remix Card" : "Create a Card"}</h1>
        <div className="flex bg-neutral-900 rounded-lg p-0.5">
          <button onClick={() => setCreateMode("ai")} disabled={loading} className={`px-3 py-1.5 rounded-md text-sm transition-colors disabled:opacity-50 ${createMode === "ai" ? "bg-neutral-700 text-neutral-100" : "text-neutral-400 hover:text-neutral-200"}`}>{`AI ${verb}`}</button>
          <button onClick={() => setCreateMode("manual")} disabled={loading} className={`px-3 py-1.5 rounded-md text-sm transition-colors disabled:opacity-50 ${createMode === "manual" ? "bg-neutral-700 text-neutral-100" : "text-neutral-400 hover:text-neutral-200"}`}>{`Manual ${verb}`}</button>
        </div>
      </div>
      {error && <div className="mb-4 p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-300 text-sm">{error}</div>}
      {loading && <LoadingSpinner message={createMode === "manual" ? "Building your card... this can take a few seconds" : "Generating your card... this takes about 5-10 seconds"} />}
      <div className={loading ? "hidden" : ""}>
        {createMode === "manual" ? (
          <CardEditForm initialCardData={BLANK_CARD} onSave={handleManualCreate} loading={loading} submitLabel={mode === "copy" ? "Create Remix" : "Create Card"} alwaysShowSubmit />
        ) : (
          <CreateForm onSubmit={handleCreate} loading={loading} />
        )}
      </div>
    </div>
  );
}
