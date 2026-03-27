import { useNavigate, Link } from "react-router-dom";
import type { Card } from "../types/card";
import { deleteCard } from "../api/client";

export function CardView({ card, canEdit, canDelete }: { card: Card; canEdit: boolean; canDelete: boolean }) {
  const navigate = useNavigate();
  const name = card.cardData?.name || "Untitled";

  async function handleDelete() {
    if (!confirm(`Delete "${name}"?`)) return;
    await deleteCard(card.id);
    navigate("/");
  }

  return (
    <div className="flex flex-col lg:flex-row gap-8">
      <div className="flex-shrink-0">
        {card.renderedUrl ? (
          <img src={card.renderedUrl} alt={name} className="w-full max-w-sm rounded-lg shadow-2xl" />
        ) : (
          <div className="w-full max-w-sm aspect-[5/7] bg-neutral-800 rounded-lg flex items-center justify-center">
            <span className="text-neutral-500">No render available</span>
          </div>
        )}
      </div>
      <div className="flex-1 space-y-6">
        <div>
          <h1 className="font-display text-3xl text-gold-400">{name}</h1>
          {card.cardData?.manaCost && <p className="text-neutral-400 mt-1 font-mono">{card.cardData.manaCost}</p>}
        </div>
        <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4">
          <h3 className="text-xs uppercase tracking-wider text-neutral-500 mb-2">Card Text</h3>
          <pre className="text-sm text-neutral-200 whitespace-pre-wrap font-mono">{card.crucibleText}</pre>
        </div>
        {card.explanation && (
          <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4">
            <h3 className="text-xs uppercase tracking-wider text-neutral-500 mb-2">Design Notes</h3>
            <p className="text-sm text-neutral-300">{card.explanation}</p>
          </div>
        )}
        {(card.suggestionArtwork || card.suggestionMechanics) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {card.suggestionArtwork && (
              <Link to={`/card/${card.id}/edit`} state={{ suggestion: card.suggestionArtwork }} className="bg-neutral-900 border border-neutral-800 rounded-lg p-3 hover:border-gold-500/50 transition-colors">
                <h4 className="text-xs uppercase tracking-wider text-neutral-500 mb-1">Art Suggestion</h4>
                <p className="text-sm text-neutral-300">{card.suggestionArtwork}</p>
              </Link>
            )}
            {card.suggestionMechanics && (
              <Link to={`/card/${card.id}/edit`} state={{ suggestion: card.suggestionMechanics }} className="bg-neutral-900 border border-neutral-800 rounded-lg p-3 hover:border-gold-500/50 transition-colors">
                <h4 className="text-xs uppercase tracking-wider text-neutral-500 mb-1">Mechanics Suggestion</h4>
                <p className="text-sm text-neutral-300">{card.suggestionMechanics}</p>
              </Link>
            )}
          </div>
        )}
        {card.prompt && (
          <div>
            <h3 className="text-xs uppercase tracking-wider text-neutral-500 mb-1">Original Prompt</h3>
            <p className="text-sm text-neutral-400">{card.prompt}</p>
          </div>
        )}
        <div className="flex gap-3 pt-2">
          {canEdit && (
            <>
              <Link to={`/card/${card.id}/edit`} className="px-4 py-2 bg-neutral-800 text-neutral-200 rounded-lg hover:bg-neutral-700 transition-colors text-sm">Edit with AI</Link>
              <Link to={`/card/${card.id}/copy`} className="px-4 py-2 bg-neutral-800 text-neutral-200 rounded-lg hover:bg-neutral-700 transition-colors text-sm">Copy & Remix</Link>
            </>
          )}
          {canDelete && (
            <button onClick={handleDelete} className="px-4 py-2 bg-red-900/50 text-red-300 rounded-lg hover:bg-red-900/80 transition-colors text-sm">Delete</button>
          )}
        </div>
      </div>
    </div>
  );
}
