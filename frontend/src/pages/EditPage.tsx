import { useState, useEffect } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { fetchCard, createCard, editCardFields } from "../api/client";
import type { Card, CardData } from "../types/card";
import { MtgCard } from "mtg-crucible/react";
import { CardEditForm } from "../components/CardEditForm";
import { CreateForm } from "../components/CreateForm";
import { LoadingSpinner } from "../components/LoadingSpinner";

export function EditPage({ mode: propMode }: { mode?: "edit" | "copy" }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = propMode || "edit";
  const [card, setCard] = useState<Card | null>(null);
  const [currentId, setCurrentId] = useState(id);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flashCount, setFlashCount] = useState(0);
  const editMode: "ai" | "advanced" = searchParams.get("type") === "advanced" ? "advanced" : "ai";
  const setEditMode = (next: "ai" | "advanced") => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next === "ai") params.delete("type");
      else params.set("type", next);
      return params;
    }, { replace: true });
  };

  useEffect(() => {
    if (!id) return;
    fetchCard(id).then((data) => setCard(data.card)).catch((err) => setError(err.message)).finally(() => setLoading(false));
  }, [id]);

  async function handleAIEdit(description: string) {
    if (!currentId) return;
    setSaving(true); setError(null);
    try {
      const response = await createCard(description, currentId, mode);
      if (mode === "copy") {
        // Copy creates a separate card; viewing it on its own page makes sense.
        navigate(`/card/${response.card.id}`, { state: response });
        return;
      }
      // Edit: stay on the edit page so the user can keep iterating.
      setCard(response.card);
      setCurrentId(response.card.id);
      setFlashCount((c) => c + 1);
      window.history.replaceState(null, "", `/card/${response.card.id}/edit${window.location.search}`);
    } catch (err: any) {
      setError(err.message);
      throw err; // Let CreateForm know not to clear the textarea.
    } finally { setSaving(false); }
  }

  async function handleAdvancedSave(cardData: CardData) {
    if (!currentId) return;
    setSaving(true); setError(null);
    try {
      const newId = await editCardFields(currentId, cardData);
      // Stay on edit page — update URL and reload card to show new preview.
      const data = await fetchCard(newId);
      setCard(data.card);
      setCurrentId(newId);
      setFlashCount((c) => c + 1);
      window.history.replaceState(null, "", `/card/${newId}/edit${window.location.search}`);
    } catch (err: any) { setError(err.message); }
    finally { setSaving(false); }
  }

  if (loading) return <LoadingSpinner fullScreen />;
  if (!card) return <div className="text-center text-red-400 py-16"><p>{error || "Card not found"}</p></div>;

  const title = mode === "copy" ? `Remix: ${card.cardData?.name || "Card"}` : `Edit: ${card.cardData?.name || "Card"}`;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-2xl text-gold-400">{title}</h1>
        {mode === "edit" && (
          <div className="flex bg-neutral-900 rounded-lg p-0.5">
            <button onClick={() => setEditMode("ai")} className={`px-3 py-1.5 rounded-md text-sm transition-colors ${editMode === "ai" ? "bg-neutral-700 text-neutral-100" : "text-neutral-400 hover:text-neutral-200"}`}>AI Edit</button>
            <button onClick={() => setEditMode("advanced")} className={`px-3 py-1.5 rounded-md text-sm transition-colors ${editMode === "advanced" ? "bg-neutral-700 text-neutral-100" : "text-neutral-400 hover:text-neutral-200"}`}>Advanced</button>
          </div>
        )}
      </div>
      {saving && mode === "copy" ? (
        <LoadingSpinner fullScreen message="Creating remix..." />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          <div className="lg:col-span-2 lg:sticky lg:top-20 lg:self-start">
            {card.display && (
              <div key={flashCount} className={flashCount > 0 ? "card-flash" : undefined}>
                <MtgCard card={card.display} cardText={card.scryfallText} style={{ width: "100%" }} />
              </div>
            )}
          </div>
          <div className="lg:col-span-3">
            {error && <div className="mb-4 p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-300 text-sm">{error}</div>}
            {mode === "copy" || editMode === "ai" ? (
              <div>
                <p className="text-sm text-neutral-400 mb-4">{mode === "copy" ? "Describe how you want to remix this card." : "Describe the changes you want to make."}</p>
                <CreateForm onSubmit={handleAIEdit} loading={saving} submitLabel={mode === "copy" ? "Create Remix" : "Submit Edits"} />
              </div>
            ) : (
              <CardEditForm initialCardData={card.cardData} onSave={handleAdvancedSave} loading={saving} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
