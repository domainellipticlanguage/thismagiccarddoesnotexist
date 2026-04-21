import { useState } from "react";

const IDEAS = [
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
  // Composite cards
  "A creature with an Adventure — the adventure lets you scry 2 then draw a card",
  "A werewolf that transforms: scared villager by day, bloodthirsty beast by night",
  "A split card where one half counters a spell and the other half copies it",
  "A modal double-faced card — a powerful spell on the front, a tap-land on the back",
  "A Battle — Siege that, when defeated, transforms into a flying angel",
  "An aftermath card — first half is a burn spell, second half returns it from the graveyard",
  "A Saga about the rise and fall of an ancient empire, 4 chapters",
  "An instant with Prepare",
  "A sorcery with Prepare that destroys a creature",
];

export function CreateForm({ onSubmit, loading }: { onSubmit: (desc: string) => void; loading: boolean }) {
  const [description, setDescription] = useState("");

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (description.trim() && !loading) onSubmit(description.trim()); }} className="space-y-4">
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
        <button type="submit" disabled={!description.trim() || loading} className="px-6 py-2.5 bg-gold-500 text-neutral-950 font-semibold rounded-lg hover:bg-gold-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
          {loading ? "Generating..." : "Create Card"}
        </button>
        <button type="button" onClick={() => setDescription(IDEAS[Math.floor(Math.random() * IDEAS.length)])} disabled={loading} className="px-4 py-2.5 bg-neutral-800 text-neutral-300 rounded-lg hover:bg-neutral-700 transition-colors text-sm">
          Suggest an idea
        </button>
      </div>
    </form>
  );
}
