import { useMemo, useState } from "react";
import {
  parseTypeLine,
  LINK_TYPES,
  RARITIES,
  type CardData,
  type Color,
  type LinkType,
  type Rarity,
} from "mtg-crucible/parser";
import { getCookie, setCookie } from "../lib/cookies";

// Site credit used when no Designer is given. Mirrors the backend default; we
// only avoid pre-filling the form with it so the field reads as "empty".
const DEFAULT_DESIGNER = "thismagiccarddoesnotexist.com";
const DESIGNER_COOKIE = "designer";

// The stored designer is just the user's part — the site credit is implied and
// appended only on the rendered image, never stored. This strip is defensive for
// legacy records that persisted the composed "<user> • site" string.
function stripSiteCredit(designer: string | undefined): string {
  const esc = DEFAULT_DESIGNER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (designer ?? "").replace(new RegExp("[\\s•·|/\\u2013\\u2014-]*" + esc + "\\s*$", "i"), "").trim();
}

// Layout dropdown selection: single-faced, infer-the-layout, or an explicit
// layout override.
type LayoutChoice = "none" | "auto" | LinkType;

/** Human-friendly label for a link type (the dropdown options). Native
 *  <option>s can't render badges, so newly-added layouts get an inline
 *  text flair instead. */
function linkTypeLabel(t: LinkType): string {
  if (t === "modal_dfc") return "Modal DFC";
  if (t === "prepare") return "Prepare  🔥 NEW";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// Layouts listed newest-first (by MTG introduction), so the freshest options
// sit right under "None" at the top. Plain strings (not LinkType) so we can
// list values like "room" that the package's runtime LINK_TYPES has but its
// LinkType union currently omits. Anything unranked sorts to the end, so future
// crucible additions still render.
const LAYOUT_ORDER: string[] = [
  "prepare",   // newest
  "omen",
  "room",
  "modal_dfc",
  "adventure",
  "aftermath",
  "fuse",
  "transform",
  "flip",
  "split",     // oldest
];

function orderedLinkTypes(): LinkType[] {
  const rank = (t: LinkType) => {
    const i = LAYOUT_ORDER.indexOf(t);
    return i === -1 ? LAYOUT_ORDER.length : i;
  };
  return [...LINK_TYPES].sort((a, b) => rank(a) - rank(b));
}

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

function formatColorIndicator(colors: Color[] | string | undefined): string {
  if (!colors?.length) return "";
  // crucible may hand back a raw string; normalize it through the parser.
  const list = typeof colors === "string" ? parseColorIndicator(colors) : colors;
  return list.map((c) => COLOR_TO_LETTER[c]).join("");
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
        <textarea className="input w-full resize-none" rows={2} value={form.artDescription} onChange={(e) => setField("artDescription", e.target.value)} placeholder="Prompt for AI image model" disabled={loading} />
        <p className="mt-1 text-xs text-neutral-500">Leave blank to render the card with an empty art box.</p>
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
  submitLabel?: string;
  /** Always render the in-form submit button (the create flow has no sticky
   *  desktop button of its own). Default false: button is mobile-only. */
  alwaysShowSubmit?: boolean;
}

export function CardEditForm({ initialCardData, onSave, loading, submitLabel = "Save & Re-render", alwaysShowSubmit = false }: CardEditFormProps) {
  const [front, setFront] = useState<FaceFormState>(() => initFaceForm(initialCardData));
  const [back, setBack] = useState<FaceFormState>(() => initFaceForm(initialCardData.linkedCard));
  // Layout: "none" = single-faced (no linked card); "auto" = multi-face, let
  // crucible infer the layout (linkType isn't stored); otherwise an explicit
  // layout override that IS stored. A card with a linked card but no stored
  // linkType (the new default) loads as "auto".
  const [layout, setLayout] = useState<LayoutChoice>(() => {
    if (!initialCardData.linkedCard) return "none";
    return initialCardData.linkType ?? "auto";
  });
  // Card-level Designer credit. Prefer the remembered cookie, then the card's
  // own designer (unless it's the site default, which should read as blank).
  const [designer, setDesigner] = useState<string>(() => {
    const saved = getCookie(DESIGNER_COOKIE);
    if (saved) return saved;
    return stripSiteCredit(initialCardData.designer);
  });
  // Card-level rarity (also drives the set-symbol color). Defaults to common.
  const [rarity, setRarity] = useState<Rarity>(initialCardData.rarity ?? "common");

  const cardData = useMemo((): CardData => {
    const designerValue = designer.trim() || undefined;
    const base: CardData = {
      ...initialCardData,
      ...buildFaceFields(front),
      designer: designerValue,
      rarity,
    };
    if (layout !== "none") {
      // "auto" leaves linkType undefined so crucible infers it at render time;
      // a specific choice is stored as an explicit override.
      base.linkType = layout === "auto" ? undefined : layout;
      base.linkedCard = {
        ...(initialCardData.linkedCard ?? {}),
        ...buildFaceFields(back),
        designer: designerValue,
        rarity,
      };
    } else {
      base.linkType = undefined;
      base.linkedCard = undefined;
    }
    return base;
  }, [front, back, layout, designer, rarity, initialCardData]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    // Remember the designer name so the next card pre-fills it.
    if (designer.trim()) setCookie(DESIGNER_COOKIE, designer.trim());
    onSave(cardData);
  };

  return (
    <form id="manual-edit-form" onSubmit={handleSubmit} className="space-y-6">
      <FaceFields form={front} onChange={setFront} loading={loading} />

      <div>
        <label className="block text-sm font-medium text-neutral-300 mb-1">Rarity</label>
        <select className="input" value={rarity} onChange={(e) => setRarity(e.target.value as Rarity)} disabled={loading}>
          {RARITIES.map((r) => (
            <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-neutral-300 mb-1">Designer</label>
        <input className="input" value={designer} onChange={(e) => setDesigner(e.target.value)} placeholder="Your name (shown as the card's designer)" disabled={loading} />
      </div>

      <div>
        <label className="block text-sm font-medium text-neutral-300 mb-1">Layout</label>
        <select
          className="input"
          value={layout}
          onChange={(e) => setLayout(e.target.value as LayoutChoice)}
          disabled={loading}
        >
          <option value="none">None (single-faced)</option>
          <option value="auto">Auto</option>
          {orderedLinkTypes().map((t) => (
            <option key={t} value={t}>{linkTypeLabel(t)}</option>
          ))}
        </select>
      </div>

      {layout !== "none" && (
        <fieldset className="border border-neutral-800 rounded-lg p-4 space-y-4">
          <legend className="px-2 text-sm font-medium text-neutral-400">Back Face</legend>
          <FaceFields form={back} onChange={setBack} loading={loading} />
        </fieldset>
      )}

      {/* Bottom-of-form submit. On the edit page a sticky desktop button lives
          alongside the preview, so there it's mobile-only; the create page has
          no sticky button, so it sets alwaysShowSubmit. */}
      <button type="submit" disabled={loading}
        className={`${alwaysShowSubmit ? "" : "lg:hidden"} w-full px-6 py-2.5 bg-gold-500 text-neutral-950 font-semibold rounded-lg hover:bg-gold-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-2`}>
        {loading && <span className="w-4 h-4 border-2 border-neutral-950/30 border-t-neutral-950 rounded-full animate-spin" />}
        {loading ? "Saving..." : submitLabel}
      </button>
    </form>
  );
}
