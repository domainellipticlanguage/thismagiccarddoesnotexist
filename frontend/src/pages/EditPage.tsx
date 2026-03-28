import { useState, useEffect } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { fetchCard, createCard, editCardFields } from "../api/client";
import type { Card } from "../types/card";
import { MtgCard } from "@domainellipticlanguage/mtg-crucible/react";
import { CardEditForm } from "../components/CardEditForm";
import { CreateForm } from "../components/CreateForm";
import { LoadingSpinner } from "../components/LoadingSpinner";

export function EditPage({ mode: propMode }: { mode?: "edit" | "copy" }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const mode = propMode || "edit";
  const [card, setCard] = useState<Card | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<"ai" | "advanced">("ai");

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

  async function handleAdvancedSave(crucibleText: string) {
    if (!id) return;
    setSaving(true); setError(null);
    try { navigate(`/card/${await editCardFields(id, crucibleText)}`); }
    catch (err: any) { setError(err.message); setSaving(false); }
  }

  if (loading) return <LoadingSpinner fullScreen />;
  if (!card) return <div className="text-center text-red-400 py-16"><p>{error || "Card not found"}</p></div>;

  const title = mode === "copy" ? `Remix: ${card.cardData?.name || "Card"}` : `Edit: ${card.cardData?.name || "Card"}`;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-2xl text-gold-400">{title}</h1>
        {mode === "edit" && (
          <div className="flex bg-neutral-900 rounded-lg p-0.5">
            <button onClick={() => setEditMode("ai")} className={`px-3 py-1.5 rounded-md text-sm transition-colors ${editMode === "ai" ? "bg-neutral-700 text-neutral-100" : "text-neutral-400 hover:text-neutral-200"}`}>AI Edit</button>
            <button onClick={() => setEditMode("advanced")} className={`px-3 py-1.5 rounded-md text-sm transition-colors ${editMode === "advanced" ? "bg-neutral-700 text-neutral-100" : "text-neutral-400 hover:text-neutral-200"}`}>Advanced</button>
          </div>
        )}
      </div>
      {saving ? (
        <LoadingSpinner fullScreen message={editMode === "ai" ? "AI is editing your card..." : "Re-rendering card..."} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1">
            {card.display && <MtgCard card={card.display} style={{ width: "100%" }} />}
          </div>
          <div className="lg:col-span-2">
            {error && <div className="mb-4 p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-300 text-sm">{error}</div>}
            {mode === "copy" || editMode === "ai" ? (
              <div>
                <p className="text-sm text-neutral-400 mb-4">{mode === "copy" ? "Describe how you want to remix this card." : "Describe the changes you want to make."}</p>
                <CreateForm onSubmit={handleAIEdit} loading={saving} />
              </div>
            ) : (
              <CardEditForm initialCardData={card.cardData} initialCrucibleText={card.crucibleText} onSave={handleAdvancedSave} loading={saving} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
