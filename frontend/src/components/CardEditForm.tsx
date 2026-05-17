import { useMemo, useState } from "react";
import {
  parseTypeLine,
  type CardData,
  type Color,
} from "mtg-crucible/parser";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function titleCaseWord(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function titleCaseTypeLine(s: string): string {
  return s.split(/(\s+|—|-)/).map((tok) => /\w/.test(tok) ? titleCaseWord(tok) : tok).join("");
}

function resolveTypeLineString(tl: CardData["typeLine"]): string {
  if (!tl) return "";
  if (typeof tl === "string") return titleCaseTypeLine(tl);
  const left = [...tl.supertypes, ...tl.types].map(titleCaseWord).join(" ");
  const right = tl.subtypes.map(titleCaseWord).join(" ");
  if (!right) return left;
  return `${left} — ${right}`;
}

/** Render CardData.abilities (which may be string or structured) as plain text
 *  for the simplified textarea editor. Round-trips via the parser's string form. */
function extractAbilitiesText(abilities: CardData["abilities"]): string {
  if (!abilities) return "";
  if (typeof abilities === "string") return abilities;
  const parts: string[] = [];
  if (abilities.unstructuredAbilities?.length) {
    parts.push(abilities.unstructuredAbilities.join("\n"));
  }
  const sa = abilities.structuredAbilities;
  if (sa) {
    switch (sa.kind) {
      case "planeswalker":
        for (const a of sa.loyaltyAbilities ?? []) {
          parts.push(a.cost ? `${a.cost}: ${a.text}` : a.text);
        }
        break;
      case "saga":
        for (const ch of sa.chapters ?? []) {
          const roman = ch.chapterNumbers.map(numberToRoman).join(", ");
          parts.push(`${roman} — ${ch.text}`);
        }
        break;
      case "class":
        for (const lv of sa.classLevels ?? []) {
          if (lv.cost) parts.push(`${lv.cost}: Level ${lv.level}`);
          if (lv.text) parts.push(lv.text);
        }
        break;
      case "leveler":
        for (const lv of sa.creatureLevels ?? []) {
          parts.push(`Level ${lv.level.join("-")}: ${lv.rulesText} (${lv.power}/${lv.toughness})`);
        }
        break;
      case "case":
        if (sa.caseConditions) {
          parts.push(`To solve: ${sa.caseConditions.toSolve}`);
          parts.push(`Solved: ${sa.caseConditions.solved}`);
        }
        break;
      case "prototype":
        if (sa.prototype) {
          parts.push(`Prototype ${sa.prototype.manaCost} — ${sa.prototype.power}/${sa.prototype.toughness}`);
        }
        break;
      case "mutate":
        if (sa.mutateCost) parts.push(`Mutate ${sa.mutateCost}`);
        break;
    }
  }
  return parts.join("\n");
}

function numberToRoman(n: number): string {
  switch (n) {
    case 1: return "I"; case 2: return "II"; case 3: return "III";
    case 4: return "IV"; case 5: return "V"; case 6: return "VI";
    default: return String(n);
  }
}

const COLOR_LETTER: Record<string, Color> = {
  w: "white", u: "blue", b: "black", r: "red", g: "green",
};
const COLOR_TO_LETTER: Record<Color, string> = {
  white: "W", blue: "U", black: "B", red: "R", green: "G",
};
const COLOR_NAMES: Color[] = ["white", "blue", "black", "red", "green"];

function parseColorIndicator(text: string): Color[] {
  const seen = new Set<Color>();
  const out: Color[] = [];
  const push = (c: Color) => {
    if (!seen.has(c)) { seen.add(c); out.push(c); }
  };
  for (const raw of text.toLowerCase().split(/[\s,]+/).filter(Boolean)) {
    if (COLOR_NAMES.includes(raw as Color)) {
      push(raw as Color);
      continue;
    }
    for (const ch of raw) {
      const c = COLOR_LETTER[ch];
      if (c) push(c);
    }
  }
  return out;
}

function formatColorIndicator(colors: Color[] | undefined): string {
  if (!colors?.length) return "";
  return colors.map((c) => COLOR_TO_LETTER[c]).join("");
}

// ---------------------------------------------------------------------------
// Per-face form state + sub-component
// ---------------------------------------------------------------------------

interface FaceFormState {
  name: string;
  manaCost: string;
  typeLine: string;
  colorIndicator: string;
  abilitiesText: string;
  flavorText: string;
  artDescription: string;
  power: string;
  toughness: string;
  startingLoyalty: string;
  battleDefense: string;
}

function initFaceForm(cd?: CardData): FaceFormState {
  return {
    name: cd?.name ?? "",
    manaCost: cd?.manaCost ?? "",
    typeLine: resolveTypeLineString(cd?.typeLine),
    colorIndicator: formatColorIndicator(cd?.colorIndicator),
    abilitiesText: extractAbilitiesText(cd?.abilities),
    flavorText: cd?.flavorText ?? "",
    artDescription: cd?.artDescription ?? "",
    power: cd?.power ?? "",
    toughness: cd?.toughness ?? "",
    startingLoyalty: cd?.startingLoyalty ?? "",
    battleDefense: cd?.battleDefense ?? "",
  };
}

/** Build the editable subset of CardData for one face. Caller is responsible
 *  for spreading this over any preserved fields. */
function buildFaceFields(form: FaceFormState): Partial<CardData> {
  const types = parseTypeLine(form.typeLine).types;
  const showPT = types.includes("creature");
  const showLoyalty = types.includes("planeswalker");
  const showDefense = types.includes("battle");
  const colorIndicator = parseColorIndicator(form.colorIndicator);
  return {
    name: form.name || undefined,
    manaCost: form.manaCost || undefined,
    typeLine: form.typeLine || undefined,
    colorIndicator: colorIndicator.length ? colorIndicator : undefined,
    abilities: form.abilitiesText.trim() || undefined,
    flavorText: form.flavorText || undefined,
    artDescription: form.artDescription || undefined,
    power: showPT && form.power ? form.power : undefined,
    toughness: showPT && form.toughness ? form.toughness : undefined,
    startingLoyalty: showLoyalty && form.startingLoyalty ? form.startingLoyalty : undefined,
    battleDefense: showDefense && form.battleDefense ? form.battleDefense : undefined,
  };
}

interface FaceFieldsProps {
  form: FaceFormState;
  onChange: (f: FaceFormState) => void;
  loading: boolean;
}

function FaceFields({ form, onChange, loading }: FaceFieldsProps) {
  const setField = <K extends keyof FaceFormState>(key: K, value: FaceFormState[K]) =>
    onChange({ ...form, [key]: value });

  const parsedTypes = useMemo(() => parseTypeLine(form.typeLine).types, [form.typeLine]);
  const showPT = parsedTypes.includes("creature");
  const showLoyalty = parsedTypes.includes("planeswalker");
  const showDefense = parsedTypes.includes("battle");

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-neutral-300 mb-1">Name</label>
          <input className="input" value={form.name} onChange={(e) => setField("name", e.target.value)} placeholder="Card Name" disabled={loading} />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-300 mb-1">Mana Cost</label>
          <input className="input font-mono" value={form.manaCost} onChange={(e) => setField("manaCost", e.target.value)} placeholder="{2}{U}{R}" disabled={loading} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4">
        <div>
          <label className="block text-sm font-medium text-neutral-300 mb-1">Type Line</label>
          <input className="input" value={form.typeLine} onChange={(e) => setField("typeLine", e.target.value)} placeholder="Legendary Creature — Human Wizard" disabled={loading} />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-300 mb-1">Color Indicator</label>
          <input className="input font-mono sm:w-24" value={form.colorIndicator} onChange={(e) => setField("colorIndicator", e.target.value)} placeholder="WU" disabled={loading} />
        </div>
      </div>

      {(showPT || showLoyalty || showDefense) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {showPT && (
            <>
              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-1">Power</label>
                <input className="input" value={form.power} onChange={(e) => setField("power", e.target.value)} placeholder="*" disabled={loading} />
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-1">Toughness</label>
                <input className="input" value={form.toughness} onChange={(e) => setField("toughness", e.target.value)} placeholder="*" disabled={loading} />
              </div>
            </>
          )}
          {showLoyalty && (
            <div>
              <label className="block text-sm font-medium text-neutral-300 mb-1">Starting Loyalty</label>
              <input className="input" value={form.startingLoyalty} onChange={(e) => setField("startingLoyalty", e.target.value)} placeholder="4" disabled={loading} />
            </div>
          )}
          {showDefense && (
            <div>
              <label className="block text-sm font-medium text-neutral-300 mb-1">Defense</label>
              <input className="input" value={form.battleDefense} onChange={(e) => setField("battleDefense", e.target.value)} placeholder="5" disabled={loading} />
            </div>
          )}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-neutral-300 mb-1">Abilities</label>
        <textarea className="input w-full resize-none" rows={5} value={form.abilitiesText} onChange={(e) => setField("abilitiesText", e.target.value)} placeholder="Card abilities text (one ability per line)" disabled={loading} />
      </div>

      <div>
        <label className="block text-sm font-medium text-neutral-300 mb-1">Flavor Text</label>
        <textarea className="input w-full resize-none" rows={2} value={form.flavorText} onChange={(e) => setField("flavorText", e.target.value)} placeholder="Italic flavor text..." disabled={loading} />
      </div>

      <div>
        <label className="block text-sm font-medium text-neutral-300 mb-1">Art Description</label>
        <textarea className="input w-full resize-none" rows={2} value={form.artDescription} onChange={(e) => setField("artDescription", e.target.value)} placeholder="Describe the card art..." disabled={loading} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

interface CardEditFormProps {
  initialCardData: CardData;
  onSave: (cardData: CardData) => void;
  loading: boolean;
}

export function CardEditForm({ initialCardData, onSave, loading }: CardEditFormProps) {
  const [front, setFront] = useState<FaceFormState>(() => initFaceForm(initialCardData));
  const [back, setBack] = useState<FaceFormState>(() => initFaceForm(initialCardData.linkedCard));
  const [multiFace, setMultiFace] = useState<boolean>(!!initialCardData.linkedCard);

  const cardData = useMemo((): CardData => {
    const base: CardData = {
      ...initialCardData,
      ...buildFaceFields(front),
    };
    if (multiFace) {
      base.linkType = initialCardData.linkType ?? "transform";
      base.linkedCard = {
        ...(initialCardData.linkedCard ?? {}),
        ...buildFaceFields(back),
      };
    } else {
      base.linkType = undefined;
      base.linkedCard = undefined;
    }
    return base;
  }, [front, back, multiFace, initialCardData]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!loading) onSave(cardData);
  };

  return (
    <form id="advanced-edit-form" onSubmit={handleSubmit} className="space-y-6">
      <FaceFields form={front} onChange={setFront} loading={loading} />

      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          className="w-4 h-4 accent-gold-500"
          checked={multiFace}
          onChange={(e) => setMultiFace(e.target.checked)}
          disabled={loading}
        />
        <span className="text-sm font-medium text-neutral-300">Multi-face card</span>
      </label>

      {multiFace && (
        <fieldset className="border border-neutral-800 rounded-lg p-4 space-y-4">
          <legend className="px-2 text-sm font-medium text-neutral-400">Back Face</legend>
          <FaceFields form={back} onChange={setBack} loading={loading} />
        </fieldset>
      )}

      {/* Bottom-of-form submit — only on narrow screens where the sticky
          card+button above scrolls away. Desktop relies on the sticky one. */}
      <button type="submit" disabled={loading}
        className="lg:hidden w-full px-6 py-2.5 bg-gold-500 text-neutral-950 font-semibold rounded-lg hover:bg-gold-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-2">
        {loading && <span className="w-4 h-4 border-2 border-neutral-950/30 border-t-neutral-950 rounded-full animate-spin" />}
        {loading ? "Saving..." : "Save & Re-render"}
      </button>
    </form>
  );
}
