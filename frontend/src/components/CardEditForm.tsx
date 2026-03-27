import { useState, useEffect, useCallback, useMemo } from "react";
import type {
  CardData,
  Rarity,
  TemplateName,
  FrameColor,
  AccentColor,
  FrameEffect,
  Supertype,
  Type,
} from "@domainellipticlanguage/mtg-crucible";
import {
  CARD_TYPES,
  RARITIES,
  TEMPLATE_NAMES,
  FRAME_COLORS,
  FRAME_EFFECTS,
} from "../types/card";

// ---------------------------------------------------------------------------
// Helpers (client-side only, no crucible runtime imports)
// ---------------------------------------------------------------------------

const SUPERTYPES: Supertype[] = ["legendary", "basic", "snow", "world"];

function numberToRoman(n: number): string {
  switch (n) {
    case 1: return "I"; case 2: return "II"; case 3: return "III";
    case 4: return "IV"; case 5: return "V"; case 6: return "VI";
    default: return String(n);
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatList(items: string[]): string {
  const cap = items.map(capitalize);
  if (cap.length <= 1) return cap[0] ?? "";
  if (cap.length === 2) return `${cap[0]} and ${cap[1]}`;
  return cap.slice(0, -1).join(", ") + ", and " + cap[cap.length - 1];
}

/** Extract the plain abilities text from CardData.abilities */
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
        for (const a of sa.loyaltyAbilities) {
          parts.push(a.cost ? `${a.cost}: ${a.text}` : a.text);
        }
        break;
      case "saga":
        for (const ch of sa.chapters) {
          const nums = ch.chapterNumbers.map(numberToRoman).join(", ");
          parts.push(`${nums} \u2014 ${ch.text}`);
        }
        break;
      case "class":
        for (const lv of sa.classLevels) {
          if (lv.cost) parts.push(`${lv.cost}: Level ${lv.level}`);
          if (lv.text) parts.push(lv.text);
        }
        break;
      case "leveler":
        for (const lv of sa.creatureLevels) {
          parts.push(`Level ${lv.level.join("-")}: ${lv.rulesText} (${lv.power}/${lv.toughness})`);
        }
        break;
      case "case":
        parts.push(`To solve: ${sa.caseConditions.toSolve}`);
        parts.push(`Solved: ${sa.caseConditions.solved}`);
        break;
      case "prototype":
        parts.push(`Prototype ${sa.prototype.manaCost} \u2014 ${sa.prototype.power}/${sa.prototype.toughness}`);
        break;
      case "mutate":
        parts.push(`Mutate ${sa.mutateCost}`);
        break;
      default:
        break;
    }
  }
  return parts.join("\n");
}

/** Detect structured ability kind from types + text */
type StructuredKind = "planeswalker" | "saga" | "class" | null;

function detectStructuredKind(types: Type[], text: string): StructuredKind {
  if (types.includes("planeswalker")) return "planeswalker";
  // Check subtypes or explicit saga/class patterns
  const lower = text.toLowerCase();
  if (types.includes("enchantment")) {
    // saga chapters use roman numerals
    if (/^(I{1,3}|IV|V|VI)\s*[,\u2014]/m.test(text)) return "saga";
    // class levels
    if (/level\s+\d/i.test(lower)) return "class";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Structured ability sub-editors
// ---------------------------------------------------------------------------

interface PlaneswalkerAbility {
  cost: string;
  text: string;
}

function parsePlaneswalkerAbilities(text: string): PlaneswalkerAbility[] {
  if (!text.trim()) return [{ cost: "+1", text: "" }, { cost: "-2", text: "" }, { cost: "-6", text: "" }];
  return text.split("\n").filter(Boolean).map((line) => {
    const m = line.match(/^([+-]?\d+|0)\s*:\s*(.*)$/);
    if (m) return { cost: m[1], text: m[2] };
    return { cost: "", text: line };
  });
}

function formatPlaneswalkerAbilities(abilities: PlaneswalkerAbility[]): string {
  return abilities
    .map((a) => (a.cost ? `${a.cost}: ${a.text}` : a.text))
    .join("\n");
}

function PlaneswalkerEditor({
  abilities,
  onChange,
}: {
  abilities: PlaneswalkerAbility[];
  onChange: (abilities: PlaneswalkerAbility[]) => void;
}) {
  const update = (index: number, field: "cost" | "text", value: string) => {
    const next = [...abilities];
    next[index] = { ...next[index], [field]: value };
    onChange(next);
  };
  const add = () => onChange([...abilities, { cost: "0", text: "" }]);
  const remove = (i: number) => onChange(abilities.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-neutral-400">Loyalty Abilities</label>
      {abilities.map((a, i) => (
        <div key={i} className="flex gap-2 items-start">
          <input
            className="input w-16 font-mono text-center"
            value={a.cost}
            onChange={(e) => update(i, "cost", e.target.value)}
            placeholder="+1"
          />
          <input
            className="input flex-1"
            value={a.text}
            onChange={(e) => update(i, "text", e.target.value)}
            placeholder="Ability text"
          />
          <button
            type="button"
            onClick={() => remove(i)}
            className="px-2 py-1.5 text-neutral-500 hover:text-red-400 transition-colors"
            title="Remove ability"
          >
            &times;
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="text-sm text-gold-400 hover:text-gold-300 transition-colors"
      >
        + Add ability
      </button>
    </div>
  );
}

// --- Saga ---

interface SagaChapter {
  chapterNumbers: number[];
  text: string;
}

function parseSagaChapters(text: string): SagaChapter[] {
  if (!text.trim()) return [{ chapterNumbers: [1], text: "" }, { chapterNumbers: [2], text: "" }, { chapterNumbers: [3], text: "" }];
  const chapters: SagaChapter[] = [];
  for (const line of text.split("\n").filter(Boolean)) {
    const m = line.match(/^((?:I{1,3}|IV|V|VI)(?:\s*,\s*(?:I{1,3}|IV|V|VI))*)\s*\u2014\s*(.*)$/);
    if (m) {
      const nums = m[1].split(",").map((s) => romanToNumber(s.trim()));
      chapters.push({ chapterNumbers: nums, text: m[2] });
    } else {
      chapters.push({ chapterNumbers: [chapters.length + 1], text: line });
    }
  }
  return chapters;
}

function romanToNumber(r: string): number {
  const map: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6 };
  return map[r] ?? (parseInt(r, 10) || 1);
}

function formatSagaChapters(chapters: SagaChapter[]): string {
  return chapters
    .map((ch) => {
      const nums = ch.chapterNumbers.map(numberToRoman).join(", ");
      return `${nums} \u2014 ${ch.text}`;
    })
    .join("\n");
}

function SagaEditor({
  chapters,
  onChange,
}: {
  chapters: SagaChapter[];
  onChange: (chapters: SagaChapter[]) => void;
}) {
  const update = (index: number, text: string) => {
    const next = [...chapters];
    next[index] = { ...next[index], text };
    onChange(next);
  };
  const add = () => {
    const nextNum = chapters.length > 0
      ? Math.max(...chapters.flatMap((c) => c.chapterNumbers)) + 1
      : 1;
    onChange([...chapters, { chapterNumbers: [nextNum], text: "" }]);
  };
  const remove = (i: number) => onChange(chapters.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-neutral-400">Saga Chapters</label>
      {chapters.map((ch, i) => (
        <div key={i} className="flex gap-2 items-start">
          <span className="w-12 py-1.5 text-center text-gold-400 font-semibold text-sm shrink-0">
            {ch.chapterNumbers.map(numberToRoman).join(", ")}
          </span>
          <input
            className="input flex-1"
            value={ch.text}
            onChange={(e) => update(i, e.target.value)}
            placeholder="Chapter effect"
          />
          <button
            type="button"
            onClick={() => remove(i)}
            className="px-2 py-1.5 text-neutral-500 hover:text-red-400 transition-colors"
            title="Remove chapter"
          >
            &times;
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="text-sm text-gold-400 hover:text-gold-300 transition-colors"
      >
        + Add chapter
      </button>
    </div>
  );
}

// --- Class ---

interface ClassLevel {
  level: number;
  cost: string;
  text: string;
}

function parseClassLevels(text: string): ClassLevel[] {
  if (!text.trim()) return [{ level: 1, cost: "", text: "" }, { level: 2, cost: "", text: "" }];
  const levels: ClassLevel[] = [];
  const lines = text.split("\n").filter(Boolean);
  let current: ClassLevel | null = null;
  for (const line of lines) {
    const m = line.match(/^(.+?):\s*Level\s+(\d+)/i);
    if (m) {
      if (current) levels.push(current);
      current = { level: parseInt(m[2], 10), cost: m[1], text: "" };
    } else if (current) {
      current.text = current.text ? current.text + "\n" + line : line;
    } else {
      // Text before any level header, treat as level 1 base text
      levels.push({ level: 1, cost: "", text: line });
    }
  }
  if (current) levels.push(current);
  return levels;
}

function formatClassLevels(levels: ClassLevel[]): string {
  const parts: string[] = [];
  for (const lv of levels) {
    if (lv.cost) parts.push(`${lv.cost}: Level ${lv.level}`);
    if (lv.text) parts.push(lv.text);
  }
  return parts.join("\n");
}

function ClassEditor({
  levels,
  onChange,
}: {
  levels: ClassLevel[];
  onChange: (levels: ClassLevel[]) => void;
}) {
  const update = (index: number, field: keyof ClassLevel, value: string | number) => {
    const next = [...levels];
    next[index] = { ...next[index], [field]: value };
    onChange(next);
  };
  const add = () => {
    const nextLevel = levels.length > 0 ? Math.max(...levels.map((l) => l.level)) + 1 : 1;
    onChange([...levels, { level: nextLevel, cost: "", text: "" }]);
  };
  const remove = (i: number) => onChange(levels.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-neutral-400">Class Levels</label>
      {levels.map((lv, i) => (
        <div key={i} className="space-y-1 p-2 border border-neutral-800 rounded-lg">
          <div className="flex gap-2 items-center">
            <span className="text-sm text-neutral-400 w-16 shrink-0">Level {lv.level}</span>
            <input
              className="input flex-1"
              value={lv.cost}
              onChange={(e) => update(i, "cost", e.target.value)}
              placeholder="Mana cost (e.g. {1}{W})"
            />
            <button
              type="button"
              onClick={() => remove(i)}
              className="px-2 py-1.5 text-neutral-500 hover:text-red-400 transition-colors"
              title="Remove level"
            >
              &times;
            </button>
          </div>
          <textarea
            className="input w-full resize-none"
            rows={2}
            value={lv.text}
            onChange={(e) => update(i, "text", e.target.value)}
            placeholder="Level effect text"
          />
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="text-sm text-gold-400 hover:text-gold-300 transition-colors"
      >
        + Add level
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Build crucible text (client-side string concatenation)
// ---------------------------------------------------------------------------

interface FormState {
  name: string;
  manaCost: string;
  supertypes: Supertype[];
  types: Type[];
  subtypes: string;
  rarity: Rarity;
  abilitiesText: string;
  power: string;
  toughness: string;
  startingLoyalty: string;
  battleDefense: string;
  flavorText: string;
  artDescription: string;
  // Visual overrides
  cardTemplate: TemplateName | "";
  frameColor: FrameColor | "";
  accentColor: AccentColor | "";
  frameEffect: FrameEffect | "";
}

function buildCrucibleText(form: FormState): string {
  const lines: string[] = [];

  // Line 1: Name {ManaCost}
  let nameLine = form.name || "Untitled";
  if (form.manaCost) nameLine += ` ${form.manaCost}`;
  lines.push(nameLine);

  // Metadata
  if (form.artDescription) lines.push(`Art Description: ${form.artDescription}`);
  if (form.rarity) lines.push(`Rarity: ${form.rarity}`);
  if (form.accentColor) lines.push(`Accent: ${capitalize(form.accentColor)}`);
  if (form.frameColor) lines.push(`Frame Color: ${capitalize(form.frameColor)}`);
  if (form.frameEffect && form.frameEffect !== "normal") lines.push(`Frame Effect: ${capitalize(form.frameEffect)}`);

  // Type line
  const typeParts: string[] = [];
  for (const st of form.supertypes) typeParts.push(capitalize(st));
  for (const t of form.types) typeParts.push(capitalize(t));
  let typeLine = typeParts.join(" ");
  const subtypesList = form.subtypes
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (subtypesList.length > 0) {
    typeLine += " \u2014 " + subtypesList.join(" ");
  }
  lines.push(typeLine);

  // Loyalty / Defense (before abilities for pw/battle)
  if (form.startingLoyalty) lines.push(`Loyalty: ${form.startingLoyalty}`);
  if (form.battleDefense) lines.push(`Defense: ${form.battleDefense}`);

  // Abilities
  if (form.abilitiesText.trim()) lines.push(form.abilitiesText.trim());

  // P/T
  if (form.power && form.toughness) {
    lines.push(`${form.power}/${form.toughness}`);
  }

  // Flavor text
  if (form.flavorText) {
    for (const fl of form.flavorText.split("\n")) {
      lines.push(`Flavor Text: ${fl}`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

interface CardEditFormProps {
  initialCardData: CardData;
  initialCrucibleText: string;
  onSave: (crucibleText: string) => void;
  loading: boolean;
}

export function CardEditForm({
  initialCardData,
  initialCrucibleText,
  onSave,
  loading,
}: CardEditFormProps) {
  const cd = initialCardData;

  const [form, setForm] = useState<FormState>(() => ({
    name: cd.name ?? "",
    manaCost: cd.manaCost ?? "",
    supertypes: cd.supertypes ?? [],
    types: cd.types ?? [],
    subtypes: (cd.subtypes ?? []).join(" "),
    rarity: cd.rarity ?? "common",
    abilitiesText: extractAbilitiesText(cd.abilities),
    power: cd.power ?? "",
    toughness: cd.toughness ?? "",
    startingLoyalty: cd.startingLoyalty ?? "",
    battleDefense: cd.battleDefense ?? "",
    flavorText: cd.flavorText ?? "",
    artDescription: cd.artDescription ?? "",
    cardTemplate: cd.cardTemplate ?? "",
    frameColor: (Array.isArray(cd.frameColor) ? cd.frameColor[0] : cd.frameColor) ?? "",
    accentColor: (Array.isArray(cd.accentColor) ? cd.accentColor[0] : cd.accentColor) ?? "",
    frameEffect: (Array.isArray(cd.frameEffect) ? cd.frameEffect[0] : cd.frameEffect) ?? "",
  }));

  // Structured editor state
  const [useStructuredEditor, setUseStructuredEditor] = useState(false);
  const structuredKind = useMemo(
    () => detectStructuredKind(form.types, form.abilitiesText),
    [form.types, form.abilitiesText],
  );

  const [pwAbilities, setPwAbilities] = useState<PlaneswalkerAbility[]>(() =>
    parsePlaneswalkerAbilities(structuredKind === "planeswalker" ? form.abilitiesText : ""),
  );
  const [sagaChapters, setSagaChapters] = useState<SagaChapter[]>(() =>
    parseSagaChapters(structuredKind === "saga" ? form.abilitiesText : ""),
  );
  const [classLevels, setClassLevels] = useState<ClassLevel[]>(() =>
    parseClassLevels(structuredKind === "class" ? form.abilitiesText : ""),
  );

  // Sync structured editors -> abilitiesText
  const updateAbilitiesFromStructured = useCallback(
    (kind: StructuredKind) => {
      if (!kind || !useStructuredEditor) return;
      let text = "";
      switch (kind) {
        case "planeswalker":
          text = formatPlaneswalkerAbilities(pwAbilities);
          break;
        case "saga":
          text = formatSagaChapters(sagaChapters);
          break;
        case "class":
          text = formatClassLevels(classLevels);
          break;
      }
      setForm((f) => ({ ...f, abilitiesText: text }));
    },
    [useStructuredEditor, pwAbilities, sagaChapters, classLevels],
  );

  useEffect(() => {
    updateAbilitiesFromStructured(structuredKind);
  }, [updateAbilitiesFromStructured, structuredKind]);

  // Re-parse structured data when switching to structured mode
  const toggleStructuredEditor = useCallback(() => {
    if (!useStructuredEditor && structuredKind) {
      // Entering structured mode: parse current text
      switch (structuredKind) {
        case "planeswalker":
          setPwAbilities(parsePlaneswalkerAbilities(form.abilitiesText));
          break;
        case "saga":
          setSagaChapters(parseSagaChapters(form.abilitiesText));
          break;
        case "class":
          setClassLevels(parseClassLevels(form.abilitiesText));
          break;
      }
    }
    setUseStructuredEditor((v) => !v);
  }, [useStructuredEditor, structuredKind, form.abilitiesText]);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const toggleSupertype = (st: Supertype) => {
    setForm((f) => ({
      ...f,
      supertypes: f.supertypes.includes(st)
        ? f.supertypes.filter((s) => s !== st)
        : [...f.supertypes, st],
    }));
  };

  const toggleType = (t: Type) => {
    setForm((f) => ({
      ...f,
      types: f.types.includes(t)
        ? f.types.filter((x) => x !== t)
        : [...f.types, t],
    }));
  };

  const crucibleText = useMemo(() => buildCrucibleText(form), [form]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!loading) onSave(crucibleText);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Name & Mana Cost */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-neutral-300 mb-1">Name</label>
          <input
            className="input"
            value={form.name}
            onChange={(e) => setField("name", e.target.value)}
            placeholder="Card Name"
            disabled={loading}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-300 mb-1">Mana Cost</label>
          <input
            className="input font-mono"
            value={form.manaCost}
            onChange={(e) => setField("manaCost", e.target.value)}
            placeholder="{2}{U}{R}"
            disabled={loading}
          />
        </div>
      </div>

      {/* Supertypes */}
      <div>
        <label className="block text-sm font-medium text-neutral-300 mb-1">Supertypes</label>
        <div className="flex flex-wrap gap-2">
          {SUPERTYPES.map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => toggleSupertype(st)}
              disabled={loading}
              className={`px-3 py-1 rounded text-sm transition-colors ${
                form.supertypes.includes(st)
                  ? "bg-gold-500 text-neutral-950 font-semibold"
                  : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
              }`}
            >
              {capitalize(st)}
            </button>
          ))}
        </div>
      </div>

      {/* Types */}
      <div>
        <label className="block text-sm font-medium text-neutral-300 mb-1">Types</label>
        <div className="flex flex-wrap gap-2">
          {CARD_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => toggleType(t as Type)}
              disabled={loading}
              className={`px-3 py-1 rounded text-sm transition-colors ${
                form.types.includes(t as Type)
                  ? "bg-gold-500 text-neutral-950 font-semibold"
                  : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
              }`}
            >
              {capitalize(t)}
            </button>
          ))}
        </div>
      </div>

      {/* Subtypes */}
      <div>
        <label className="block text-sm font-medium text-neutral-300 mb-1">Subtypes</label>
        <input
          className="input"
          value={form.subtypes}
          onChange={(e) => setField("subtypes", e.target.value)}
          placeholder="Human Wizard"
          disabled={loading}
        />
      </div>

      {/* Rarity */}
      <div>
        <label className="block text-sm font-medium text-neutral-300 mb-1">Rarity</label>
        <select
          className="input"
          value={form.rarity}
          onChange={(e) => setField("rarity", e.target.value as Rarity)}
          disabled={loading}
        >
          {RARITIES.map((r) => (
            <option key={r} value={r}>
              {capitalize(r)}
            </option>
          ))}
        </select>
      </div>

      {/* Abilities */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-sm font-medium text-neutral-300">Abilities</label>
          {structuredKind && (
            <button
              type="button"
              onClick={toggleStructuredEditor}
              className="text-xs text-gold-400 hover:text-gold-300 transition-colors"
            >
              {useStructuredEditor ? "Switch to text editor" : "Switch to structured editor"}
            </button>
          )}
        </div>

        {useStructuredEditor && structuredKind === "planeswalker" ? (
          <PlaneswalkerEditor abilities={pwAbilities} onChange={setPwAbilities} />
        ) : useStructuredEditor && structuredKind === "saga" ? (
          <SagaEditor chapters={sagaChapters} onChange={setSagaChapters} />
        ) : useStructuredEditor && structuredKind === "class" ? (
          <ClassEditor levels={classLevels} onChange={setClassLevels} />
        ) : (
          <textarea
            className="input w-full resize-none"
            rows={5}
            value={form.abilitiesText}
            onChange={(e) => setField("abilitiesText", e.target.value)}
            placeholder="Card abilities text (one ability per line)"
            disabled={loading}
          />
        )}
      </div>

      {/* Power / Toughness / Loyalty / Defense */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div>
          <label className="block text-sm font-medium text-neutral-300 mb-1">Power</label>
          <input
            className="input"
            value={form.power}
            onChange={(e) => setField("power", e.target.value)}
            placeholder="*"
            disabled={loading}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-300 mb-1">Toughness</label>
          <input
            className="input"
            value={form.toughness}
            onChange={(e) => setField("toughness", e.target.value)}
            placeholder="*"
            disabled={loading}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-300 mb-1">Loyalty</label>
          <input
            className="input"
            value={form.startingLoyalty}
            onChange={(e) => setField("startingLoyalty", e.target.value)}
            placeholder="4"
            disabled={loading}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-300 mb-1">Defense</label>
          <input
            className="input"
            value={form.battleDefense}
            onChange={(e) => setField("battleDefense", e.target.value)}
            placeholder="5"
            disabled={loading}
          />
        </div>
      </div>

      {/* Flavor Text */}
      <div>
        <label className="block text-sm font-medium text-neutral-300 mb-1">Flavor Text</label>
        <textarea
          className="input w-full resize-none"
          rows={2}
          value={form.flavorText}
          onChange={(e) => setField("flavorText", e.target.value)}
          placeholder="Italic flavor text..."
          disabled={loading}
        />
      </div>

      {/* Art Description */}
      <div>
        <label className="block text-sm font-medium text-neutral-300 mb-1">Art Description</label>
        <textarea
          className="input w-full resize-none"
          rows={2}
          value={form.artDescription}
          onChange={(e) => setField("artDescription", e.target.value)}
          placeholder="Describe the card art..."
          disabled={loading}
        />
      </div>

      {/* Visual Overrides (collapsible) */}
      <details className="border border-neutral-800 rounded-lg">
        <summary className="px-4 py-2 cursor-pointer text-sm font-medium text-neutral-400 hover:text-neutral-300 transition-colors select-none">
          Visual Overrides
        </summary>
        <div className="px-4 pb-4 pt-2 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-neutral-300 mb-1">Card Template</label>
              <select
                className="input"
                value={form.cardTemplate}
                onChange={(e) => setField("cardTemplate", e.target.value as TemplateName | "")}
                disabled={loading}
              >
                <option value="">Auto-detect</option>
                {TEMPLATE_NAMES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-300 mb-1">Frame Color</label>
              <select
                className="input"
                value={form.frameColor}
                onChange={(e) => setField("frameColor", e.target.value as FrameColor | "")}
                disabled={loading}
              >
                <option value="">Auto-detect</option>
                {FRAME_COLORS.map((c) => (
                  <option key={c} value={c}>
                    {capitalize(c)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-300 mb-1">Accent Color</label>
              <select
                className="input"
                value={form.accentColor}
                onChange={(e) => setField("accentColor", e.target.value as AccentColor | "")}
                disabled={loading}
              >
                <option value="">None</option>
                {FRAME_COLORS.map((c) => (
                  <option key={c} value={c}>
                    {capitalize(c)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-300 mb-1">Frame Effect</label>
              <select
                className="input"
                value={form.frameEffect}
                onChange={(e) => setField("frameEffect", e.target.value as FrameEffect | "")}
                disabled={loading}
              >
                <option value="">Normal</option>
                {FRAME_EFFECTS.map((f) => (
                  <option key={f} value={f}>
                    {capitalize(f)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </details>

      {/* Live Crucible Text Preview (collapsible) */}
      <details className="border border-neutral-800 rounded-lg">
        <summary className="px-4 py-2 cursor-pointer text-sm font-medium text-neutral-400 hover:text-neutral-300 transition-colors select-none">
          Crucible Text Preview
        </summary>
        <div className="px-4 pb-4 pt-2">
          <pre className="text-sm text-neutral-300 bg-neutral-900 p-3 rounded-lg whitespace-pre-wrap font-mono leading-relaxed overflow-x-auto">
            {crucibleText}
          </pre>
        </div>
      </details>

      {/* Submit */}
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={loading}
          className="px-6 py-2.5 bg-gold-500 text-neutral-950 font-semibold rounded-lg hover:bg-gold-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </form>
  );
}
