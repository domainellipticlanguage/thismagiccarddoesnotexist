import { useNavigate, Link } from "react-router-dom";
import { MtgCard } from "mtg-crucible/react";
import type { Card } from "../types/card";
import { deleteCard } from "../api/client";
import { BugReportButton } from "./BugReportButton";

function fullName(card: Card): string {
  const a = card.cardData?.name;
  const b = card.cardData?.linkedCard?.name;
  if (a && b) return `${a} // ${b}`;
  return a || "Untitled";
}

export function CardView({ card, canEdit, canDelete }: { card: Card; canEdit: boolean; canDelete: boolean }) {
  const navigate = useNavigate();
  const name = fullName(card);

  async function handleDelete() {
    if (!confirm(`Delete "${name}"?`)) return;
    await deleteCard(card.id);
    navigate("/");
  }

  return (
    <div className="flex flex-col lg:flex-row gap-8">
      <div className="flex-shrink-0 w-full max-w-sm">
        {card.display ? (
          <MtgCard card={card.display} cardText={card.scryfallText} style={{ width: "100%" }} />
        ) : (
          <div className="w-full aspect-[5/7] bg-neutral-800 rounded-lg flex items-center justify-center animate-pulse">
            <span className="text-neutral-500">Loading card... (display: {card.display === undefined ? 'undefined' : 'null'})</span>
          </div>
        )}
      </div>
      <div className="flex-1 space-y-6">
        <div>
          <h1 className="font-display text-3xl text-gold-400">{name}</h1>
          {card.cardData?.manaCost && <p className="text-neutral-400 mt-1 font-mono">{card.cardData.manaCost}</p>}
        </div>
        <details className="bg-neutral-900 border border-neutral-800 rounded-lg">
          <summary className="px-4 py-2 cursor-pointer text-xs uppercase tracking-wider text-neutral-500 hover:text-neutral-400 transition-colors select-none">Card Text</summary>
          <div className="px-4 pb-4">
            <pre className="text-sm text-neutral-200 whitespace-pre-wrap font-mono">{card.crucibleText}</pre>
          </div>
        </details>
        {card.prompt && (
          <div>
            <h3 className="text-xs uppercase tracking-wider text-neutral-500 mb-1">Original Prompt</h3>
            <p className="text-sm text-neutral-400">{card.prompt}</p>
          </div>
        )}
        <div className="flex gap-3 pt-2">
          {canEdit && (
            <Link to={`/card/${card.id}/edit`} className="px-4 py-2 bg-neutral-800 text-neutral-200 rounded-lg hover:bg-neutral-700 transition-colors text-sm">Edit</Link>
          )}
          {/* Copy & Remix makes an independent new card, so it's open to anyone. */}
          <Link to={`/card/${card.id}/copy`} className="px-4 py-2 bg-neutral-800 text-neutral-200 rounded-lg hover:bg-neutral-700 transition-colors text-sm">Copy & Remix</Link>
          {canDelete && (
            <button onClick={handleDelete} className="px-4 py-2 bg-red-900/50 text-red-300 rounded-lg hover:bg-red-900/80 transition-colors text-sm">Delete</button>
          )}
          <BugReportButton key={card.id} cardId={card.id} />
        </div>
      </div>
    </div>
  );
}
