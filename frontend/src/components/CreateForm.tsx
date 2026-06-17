import { useState } from "react";

const IDEAS = [
  // Single-face
  "A legendary dragon that hoards enchantments",
  "An artifact creature that repairs itself",
  "A planeswalker who manipulates time",
  "A land that generates tokens",
  "A blue counterspell with a twist",
  "A green creature that grows with the forest",
  "A black enchantment that drains life",
  "A white angel that protects the weak",
  "A red goblin with explosive abilities",
  "A multicolor commander that unites tribes",
  // Multi-face cards — weighted heavier than singles so the random pick
  // surfaces these often. Covers the major layouts crucible supports.
  "A werewolf that transforms: scared villager by day, bloodthirsty beast by night",
  "A double-faced legendary — a young hero on the front who transforms into a god after a great sacrifice",
  "A transforming planeswalker that becomes a creature when you ultimate it",
  "A creature with an Adventure — the adventure lets you scry 2 then draw a card",
  "An adventure creature: a knight whose adventure half is a duel that fights any creature",
  "An adventure with a heist-themed instant adventure that steals a creature for the turn",
  "A modal double-faced card — a powerful spell on the front, a tap-land on the back",
  "An MDFC where the front is a permission spell and the back is a dual land",
  "A modal DFC: a powerful creature on one side, a dungeon-themed land on the other",
  "A split card where one half counters a spell and the other half copies it",
  "A split card: one half a board wipe, the other half a card draw spell",
  "A fused split card where both halves resolve together, one milling and one reanimating",
  "An aftermath card — first half is a burn spell, second half returns it from the graveyard",
  "An aftermath card: removal up front, then a recursion follow-up from the graveyard",
  "A Saga about the rise and fall of an ancient empire, 4 chapters",
  "A Saga that culminates in transforming into a creature with abilities echoing the chapters",
  "A Class enchantment with three levels, gaining stronger abilities as you level up",
  "A bardic Class that turns your spells into songs as you ascend levels",
  "A Battle — Siege that, when defeated, transforms into a flying angel",
  "A battle that's a planar quest — flip it after solving to become a treasure-spewing planeswalker",
  "A Kamigawa-style flip creature — a humble samurai that flips into a fearsome oni",
  "A flip creature: a meek apprentice mage who flips into an archmage on heroic triggers",
  "A Room enchantment — two doors, each with its own mana cost and effect, with chaotic synergy between them",
  "A Room enchantment where Door 1 is a defensive ward and Door 2 is an offensive curse",
  "An instant with Prepare",
  "A sorcery with Prepare that destroys a creature",
  "A mutate creature with a strong on-mutate trigger that scales with how many times you've mutated",
];

export function CreateForm({
  onSubmit,
  loading,
  submitLabel = "Create Card",
  showSuggest = true,
  onManual,
}: {
  onSubmit: (desc: string) => void | Promise<void>;
  loading: boolean;
  submitLabel?: string;
  showSuggest?: boolean;
  /** When provided, render a "Manual Create" button that switches to the
   *  field-by-field form instead of generating from a description. */
  onManual?: () => void;
}) {
  const [description, setDescription] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = description.trim();
    if (!text || loading) return;
    try {
      await onSubmit(text);
      setDescription("");
    } catch {
      // Parent surfaces the error; keep the text so the user can retry.
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="description" className="block text-sm font-medium text-neutral-300 mb-2">Describe your card</label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="A legendary creature that..."
          rows={3}
          className="w-full px-4 py-3 bg-neutral-900 border border-neutral-700 rounded-lg text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500 resize-none"
          disabled={loading}
        />
      </div>
      <div className="flex gap-3 items-center">
        <button type="submit" disabled={!description.trim() || loading} className="px-6 py-2.5 bg-gold-500 text-neutral-950 font-semibold rounded-lg hover:bg-gold-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2">
          {loading && <span className="w-4 h-4 border-2 border-neutral-950/30 border-t-neutral-950 rounded-full animate-spin" />}
          {loading ? "Generating..." : submitLabel}
        </button>
        {showSuggest && (
          <button type="button" onClick={() => setDescription(IDEAS[Math.floor(Math.random() * IDEAS.length)])} disabled={loading} className="px-4 py-2.5 bg-neutral-800 text-neutral-300 rounded-lg hover:bg-neutral-700 transition-colors text-sm">
            Suggest an idea
          </button>
        )}
        {onManual && (
          <button type="button" onClick={onManual} disabled={loading} className="px-4 py-2.5 bg-neutral-800 text-neutral-300 rounded-lg hover:bg-neutral-700 transition-colors text-sm">
            Manual Create
          </button>
        )}
      </div>
    </form>
  );
}
