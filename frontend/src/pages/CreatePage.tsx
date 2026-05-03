import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { createCard } from "../api/client";
import { CreateForm } from "../components/CreateForm";
import { LoadingSpinner } from "../components/LoadingSpinner";

export function CreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const baseId = searchParams.get("base");
  const mode = (searchParams.get("mode") as "create" | "copy") || "create";

  async function handleCreate(description: string) {
    setLoading(true);
    setError(null);
    try {
      const response = await createCard(description, baseId, mode);
      navigate(`/card/${response.card.id}`, { state: response });
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="font-display text-2xl text-gold-400 mb-6">{mode === "copy" ? "Remix Card" : "Create a Card"}</h1>
      {error && <div className="mb-4 p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-300 text-sm">{error}</div>}
      {loading && <LoadingSpinner message="Generating your card... this takes about 5-10 seconds" />}
      <div className={loading ? "hidden" : ""}>
        <CreateForm onSubmit={handleCreate} loading={loading} />
      </div>
    </div>
  );
}
