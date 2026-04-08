import { useState, useEffect, useCallback, useMemo } from "react";
import {
  parseTypeLine,
  type CardData,
  type Rarity,
  type TemplateName,
  type FrameColor,
  type AccentColor,
  type FrameEffect,
  type Supertype,
  type Type,
  type Color,
  type LinkType,
  type ParsedTypeLine,
} from "mtg-crucible/parser";
import {
  CARD_TYPES,
  RARITIES,
  FRAME_COLORS,
  FRAME_EFFECTS,
  COLORS,
  SUPERTYPES_LIST,
} from "../types/card";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SUPERTYPES = SUPERTYPES_LIST;

// ---------------------------------------------------------------------------
// Layout + Face Template types (form-only, mapped to/from CardData on save/load)
// ---------------------------------------------------------------------------

type Layout = "single" | "transform" | "mdfc" | "adventure" | "split" | "fuse" | "aftermath" | "flip";

type FaceTemplate = "" | "standard" | "planeswalker" | "saga" | "class"
  | "leveler" | "prototype" | "mutate" | "battle";

const LAYOUT_OPTIONS: { label: string; value: Layout }[] = [
  { label: "Single Face", value: "single" },
  { label: "Transform (DFC)", value: "transform" },
  { label: "Modal DFC", value: "mdfc" },
  { label: "Adventure", value: "adventure" },
  { label: "Split", value: "split" },
  { label: "Fuse", value: "fuse" },
  { label: "Aftermath", value: "aftermath" },
  { label: "Flip", value: "flip" },
];

const LAYOUT_TO_LINK_TYPE: Record<Layout, LinkType | undefined> = {
  single: undefined, transform: "transform", mdfc: "modal_dfc",
  adventure: "adventure", split: "split", fuse: "fuse",
  aftermath: "aftermath", flip: "flip",
};

const FACE_TEMPLATES: { label: string; value: FaceTemplate }[] = [
  { label: "Auto-detect", value: "" },
  { label: "Standard", value: "standard" },
  { label: "Planeswalker", value: "planeswalker" },
  { label: "Saga", value: "saga" },
  { label: "Class", value: "class" },
  { label: "Leveler", value: "leveler" },
  { label: "Prototype", value: "prototype" },
  { label: "Mutate", value: "mutate" },
  { label: "Battle", value: "battle" },
];

/** Reverse-map CardData to Layout for form initialization. */
function inferLayout(cd: CardData): Layout {
  if (cd.linkType) {
    const map: Record<LinkType, Layout> = {
      transform: "transform", modal_dfc: "mdfc", adventure: "adventure",
      split: "split", fuse: "fuse", flip: "flip", aftermath: "aftermath",
    };
    return map[cd.linkType];
  }
  const t = cd.cardTemplate;
  if (t) {
    const map: Partial<Record<TemplateName, Layout>> = {
      transform_front: "transform", transform_back: "transform",
      mdfc_front: "mdfc", mdfc_back: "mdfc",
      adventure: "adventure", split: "split", fuse: "fuse",
      flip: "flip", aftermath: "aftermath",
    };
    if (map[t]) return map[t]!;
  }
  // Fallback: if linkedCard exists but no linkType/cardTemplate, default to split
  if (cd.linkedCard) return "split";
  return "single";
}

/** Reverse-map CardData.cardTemplate to FaceTemplate for form initialization. */
function inferFaceTemplate(cd: CardData): FaceTemplate {
  const t = cd.cardTemplate;
  if (!t) return "";
  // Layout-level templates → auto-detect (the layout handles these)
  const layoutTemplates: TemplateName[] = [
    "transform_front", "transform_back", "mdfc_front", "mdfc_back",
    "adventure", "split", "fuse", "flip", "aftermath",
  ];
  if (layoutTemplates.includes(t)) return "";
  if (t === "planeswalker_tall") return "planeswalker";
  return t as FaceTemplate;
}

/** Map form (layout, faceTemplate) → CardData.cardTemplate for crucible. */
function resolveFormTemplate(layout: Layout, faceTemplate: FaceTemplate): TemplateName | undefined {
  if (!faceTemplate || faceTemplate === "standard") {
    // For single-image layouts that are templates themselves, use the layout name
    const layoutAsTemplate: Partial<Record<Layout, TemplateName>> = {
      adventure: "adventure", split: "split", fuse: "fuse",
      aftermath: "aftermath", flip: "flip",
    };
    if (layoutAsTemplate[layout]) return layoutAsTemplate[layout];
    // For transform/mdfc/single with standard/auto: let crucible auto-detect
    return undefined;
  }
  // Non-standard face template (planeswalker, saga, etc.) — pass through
  return faceTemplate as TemplateName;
}

function resolveTypeLine(tl: CardData["typeLine"]): ParsedTypeLine {
  if (!tl) return { supertypes: [], types: [], subtypes: [] };
  if (typeof tl === "string") return parseTypeLine(tl);
  return tl;
}

function numberToRoman(n: number): string {
  switch (n) {
    case 1: return "I"; case 2: return "II"; case 3: return "III";
    case 4: return "IV"; case 5: return "V"; case 6: return "VI";
    default: return String(n);
  }
}

function romanToNumber(r: string): number {
  const map: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6 };
  return map[r] ?? (parseInt(r, 10) || 1);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Infer which structured ability editor to show */
type StructuredKind = "planeswalker" | "saga" | "class" | "leveler" | "case" | "prototype" | "mutate" | null;

function detectStructuredKind(types: Type[], subtypes: string, template: FaceTemplate): StructuredKind {
  if (template === "planeswalker" || types.includes("planeswalker")) return "planeswalker";
  if (template === "saga") return "saga";
  if (template === "class") return "class";
  if (template === "leveler") return "leveler";
  if (template === "prototype") return "prototype";
  if (template === "mutate") return "mutate";
  const st = subtypes.toLowerCase();
  if (st.includes("saga")) return "saga";
  if (st.includes("class")) return "class";
  if (st.includes("case")) return "case";
  return null;
}


/** Extract plain abilities text from CardData.abilities */
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
        for (const a of sa.loyaltyAbilities ?? []) parts.push(a.cost ? `${a.cost}: ${a.text}` : a.text);
        break;
      case "saga":
        for (const ch of sa.chapters ?? []) {
          const nums = ch.chapterNumbers.map(numberToRoman).join(", ");
          parts.push(`${nums} \u2014 ${ch.text}`);
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
          parts.push(`Prototype ${sa.prototype.manaCost} \u2014 ${sa.prototype.power}/${sa.prototype.toughness}`);
        }
        break;
      case "mutate":
        if (sa.mutateCost) parts.push(`Mutate ${sa.mutateCost}`);
        break;
    }
  }
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Structured ability sub-editors
// ---------------------------------------------------------------------------

// --- Planeswalker ---

interface PlaneswalkerAbility { cost: string; text: string }

function parsePlaneswalkerAbilities(text: string): PlaneswalkerAbility[] {
  if (!text.trim()) return [{ cost: "+1", text: "" }, { cost: "-2", text: "" }, { cost: "-6", text: "" }];
  return text.split("\n").filter(Boolean).map((line) => {
    const m = line.match(/^([+-]?\d+|0)\s*:\s*(.*)$/);
    return m ? { cost: m[1], text: m[2] } : { cost: "", text: line };
  });
}

function formatPlaneswalkerAbilities(abilities: PlaneswalkerAbility[]): string {
  return abilities.map((a) => (a.cost ? `${a.cost}: ${a.text}` : a.text)).join("\n");
}

function PlaneswalkerEditor({ abilities, onChange }: { abilities: PlaneswalkerAbility[]; onChange: (a: PlaneswalkerAbility[]) => void }) {
  const update = (i: number, field: "cost" | "text", value: string) => {
    const next = [...abilities]; next[i] = { ...next[i], [field]: value }; onChange(next);
  };
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-neutral-400">Loyalty Abilities</label>
      {abilities.map((a, i) => (
        <div key={i} className="flex gap-2 items-start">
          <input className="input w-16 font-mono text-center" value={a.cost} onChange={(e) => update(i, "cost", e.target.value)} placeholder="+1" />
          <input className="input flex-1" value={a.text} onChange={(e) => update(i, "text", e.target.value)} placeholder="Ability text" />
          <button type="button" onClick={() => onChange(abilities.filter((_, idx) => idx !== i))} className="px-2 py-1.5 text-neutral-500 hover:text-red-400 transition-colors" title="Remove">&times;</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...abilities, { cost: "0", text: "" }])} className="text-sm text-gold-400 hover:text-gold-300 transition-colors">+ Add ability</button>
    </div>
  );
}

// --- Saga ---

interface SagaChapter { chapterNumbers: number[]; text: string }

function parseSagaChapters(text: string): SagaChapter[] {
  if (!text.trim()) return [{ chapterNumbers: [1], text: "" }, { chapterNumbers: [2], text: "" }, { chapterNumbers: [3], text: "" }];
  const chapters: SagaChapter[] = [];
  for (const line of text.split("\n").filter(Boolean)) {
    const m = line.match(/^((?:I{1,3}|IV|V|VI)(?:\s*,\s*(?:I{1,3}|IV|V|VI))*)\s*\u2014\s*(.*)$/);
    if (m) {
      chapters.push({ chapterNumbers: m[1].split(",").map((s) => romanToNumber(s.trim())), text: m[2] });
    } else {
      chapters.push({ chapterNumbers: [chapters.length + 1], text: line });
    }
  }
  return chapters;
}

function formatSagaChapters(chapters: SagaChapter[]): string {
  return chapters.map((ch) => `${ch.chapterNumbers.map(numberToRoman).join(", ")} \u2014 ${ch.text}`).join("\n");
}

function SagaEditor({ chapters, onChange }: { chapters: SagaChapter[]; onChange: (c: SagaChapter[]) => void }) {
  const update = (i: number, text: string) => { const next = [...chapters]; next[i] = { ...next[i], text }; onChange(next); };
  const add = () => {
    const nextNum = chapters.length > 0 ? Math.max(...chapters.flatMap((c) => c.chapterNumbers)) + 1 : 1;
    onChange([...chapters, { chapterNumbers: [nextNum], text: "" }]);
  };
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-neutral-400">Saga Chapters</label>
      {chapters.map((ch, i) => (
        <div key={i} className="flex gap-2 items-start">
          <span className="w-12 py-1.5 text-center text-gold-400 font-semibold text-sm shrink-0">{ch.chapterNumbers.map(numberToRoman).join(", ")}</span>
          <input className="input flex-1" value={ch.text} onChange={(e) => update(i, e.target.value)} placeholder="Chapter effect" />
          <button type="button" onClick={() => onChange(chapters.filter((_, idx) => idx !== i))} className="px-2 py-1.5 text-neutral-500 hover:text-red-400 transition-colors" title="Remove">&times;</button>
        </div>
      ))}
      <button type="button" onClick={add} className="text-sm text-gold-400 hover:text-gold-300 transition-colors">+ Add chapter</button>
    </div>
  );
}

// --- Class ---

interface ClassLevel { level: number; cost: string; text: string }

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

function ClassEditor({ levels, onChange }: { levels: ClassLevel[]; onChange: (l: ClassLevel[]) => void }) {
  const update = (i: number, field: keyof ClassLevel, value: string | number) => {
    const next = [...levels]; next[i] = { ...next[i], [field]: value }; onChange(next);
  };
  const add = () => {
    const nextLevel = levels.length > 0 ? Math.max(...levels.map((l) => l.level)) + 1 : 1;
    onChange([...levels, { level: nextLevel, cost: "", text: "" }]);
  };
  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-neutral-400">Class Levels</label>
      {levels.map((lv, i) => (
        <div key={i} className="space-y-1 p-2 border border-neutral-800 rounded-lg">
          <div className="flex gap-2 items-center">
            <span className="text-sm text-neutral-400 w-16 shrink-0">Level {lv.level}</span>
            <input className="input flex-1" value={lv.cost} onChange={(e) => update(i, "cost", e.target.value)} placeholder="Mana cost (e.g. {1}{W})" />
            <button type="button" onClick={() => onChange(levels.filter((_, idx) => idx !== i))} className="px-2 py-1.5 text-neutral-500 hover:text-red-400 transition-colors" title="Remove">&times;</button>
          </div>
          <textarea className="input w-full resize-none" rows={2} value={lv.text} onChange={(e) => update(i, "text", e.target.value)} placeholder="Level effect text" />
        </div>
      ))}
      <button type="button" onClick={add} className="text-sm text-gold-400 hover:text-gold-300 transition-colors">+ Add level</button>
    </div>
  );
}

// --- Leveler ---

interface LevelerLevel { levelLo: string; levelHi: string; rulesText: string; power: string; toughness: string }

function parseLevelerLevels(text: string): LevelerLevel[] {
  if (!text.trim()) return [
    { levelLo: "1", levelHi: "2", rulesText: "", power: "", toughness: "" },
    { levelLo: "3", levelHi: "5", rulesText: "", power: "", toughness: "" },
  ];
  const levels: LevelerLevel[] = [];
  for (const line of text.split("\n").filter(Boolean)) {
    const m = line.match(/^Level\s+(\d+)-(\d+):\s*(.*?)\s*\((\S+)\/(\S+)\)\s*$/i);
    if (m) {
      levels.push({ levelLo: m[1], levelHi: m[2], rulesText: m[3], power: m[4], toughness: m[5] });
    } else {
      levels.push({ levelLo: "", levelHi: "", rulesText: line, power: "", toughness: "" });
    }
  }
  return levels;
}

function formatLevelerLevels(levels: LevelerLevel[]): string {
  return levels.map((lv) => {
    if (lv.levelLo && lv.levelHi) {
      return `Level ${lv.levelLo}-${lv.levelHi}: ${lv.rulesText} (${lv.power}/${lv.toughness})`;
    }
    return lv.rulesText;
  }).join("\n");
}

function LevelerEditor({ levels, onChange }: { levels: LevelerLevel[]; onChange: (l: LevelerLevel[]) => void }) {
  const update = (i: number, field: keyof LevelerLevel, value: string) => {
    const next = [...levels]; next[i] = { ...next[i], [field]: value }; onChange(next);
  };
  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-neutral-400">Leveler Levels</label>
      {levels.map((lv, i) => (
        <div key={i} className="p-2 border border-neutral-800 rounded-lg space-y-1">
          <div className="flex gap-2 items-center">
            <span className="text-sm text-neutral-400 shrink-0">Level</span>
            <input className="input w-14 text-center" value={lv.levelLo} onChange={(e) => update(i, "levelLo", e.target.value)} placeholder="1" />
            <span className="text-neutral-500">-</span>
            <input className="input w-14 text-center" value={lv.levelHi} onChange={(e) => update(i, "levelHi", e.target.value)} placeholder="2" />
            <input className="input w-14 text-center" value={lv.power} onChange={(e) => update(i, "power", e.target.value)} placeholder="P" />
            <span className="text-neutral-500">/</span>
            <input className="input w-14 text-center" value={lv.toughness} onChange={(e) => update(i, "toughness", e.target.value)} placeholder="T" />
            <button type="button" onClick={() => onChange(levels.filter((_, idx) => idx !== i))} className="px-2 py-1.5 text-neutral-500 hover:text-red-400 transition-colors" title="Remove">&times;</button>
          </div>
          <input className="input w-full" value={lv.rulesText} onChange={(e) => update(i, "rulesText", e.target.value)} placeholder="Rules text" />
        </div>
      ))}
      <button type="button" onClick={() => onChange([...levels, { levelLo: "", levelHi: "", rulesText: "", power: "", toughness: "" }])} className="text-sm text-gold-400 hover:text-gold-300 transition-colors">+ Add level</button>
    </div>
  );
}

// --- Case ---

interface CaseState { toSolve: string; solved: string }

function parseCaseState(text: string): CaseState {
  const toSolveM = text.match(/To solve:\s*(.*)/i);
  const solvedM = text.match(/Solved:\s*(.*)/i);
  return { toSolve: toSolveM?.[1] ?? "", solved: solvedM?.[1] ?? "" };
}

function formatCaseState(c: CaseState): string {
  const parts: string[] = [];
  if (c.toSolve) parts.push(`To solve: ${c.toSolve}`);
  if (c.solved) parts.push(`Solved: ${c.solved}`);
  return parts.join("\n");
}

function CaseEditor({ state, onChange }: { state: CaseState; onChange: (s: CaseState) => void }) {
  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-neutral-400">Case Conditions</label>
      <div>
        <label className="block text-xs text-neutral-500 mb-1">To Solve</label>
        <textarea className="input w-full resize-none" rows={2} value={state.toSolve} onChange={(e) => onChange({ ...state, toSolve: e.target.value })} placeholder="Condition to solve this case" />
      </div>
      <div>
        <label className="block text-xs text-neutral-500 mb-1">Solved</label>
        <textarea className="input w-full resize-none" rows={2} value={state.solved} onChange={(e) => onChange({ ...state, solved: e.target.value })} placeholder="Effect when solved" />
      </div>
    </div>
  );
}

// --- Prototype ---

interface PrototypeState { manaCost: string; power: string; toughness: string }

function parsePrototypeState(text: string): PrototypeState {
  const m = text.match(/Prototype\s+(\S+)\s*\u2014\s*(\S+)\/(\S+)/);
  return m ? { manaCost: m[1], power: m[2], toughness: m[3] } : { manaCost: "", power: "", toughness: "" };
}

function formatPrototypeState(p: PrototypeState): string {
  if (!p.manaCost) return "";
  return `Prototype ${p.manaCost} \u2014 ${p.power}/${p.toughness}`;
}

function PrototypeEditor({ state, onChange }: { state: PrototypeState; onChange: (s: PrototypeState) => void }) {
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-neutral-400">Prototype</label>
      <div className="flex gap-2 items-center">
        <input className="input flex-1 font-mono" value={state.manaCost} onChange={(e) => onChange({ ...state, manaCost: e.target.value })} placeholder="Mana cost (e.g. {1}{R})" />
        <input className="input w-16 text-center" value={state.power} onChange={(e) => onChange({ ...state, power: e.target.value })} placeholder="P" />
        <span className="text-neutral-500">/</span>
        <input className="input w-16 text-center" value={state.toughness} onChange={(e) => onChange({ ...state, toughness: e.target.value })} placeholder="T" />
      </div>
    </div>
  );
}

// --- Mutate ---

function MutateEditor({ cost, onChange }: { cost: string; onChange: (c: string) => void }) {
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-neutral-400">Mutate Cost</label>
      <input className="input font-mono" value={cost} onChange={(e) => onChange(e.target.value)} placeholder="{1}{G}{G}" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Linked Card Editor (one level of nesting)
// ---------------------------------------------------------------------------

interface LinkedFormState {
  name: string;
  manaCost: string;
  types: Type[];
  subtypes: string;
  faceTemplate: FaceTemplate;
  abilitiesText: string;
  power: string;
  toughness: string;
  startingLoyalty: string;
  battleDefense: string;
  flavorText: string;
  artDescription: string;
}

function initLinkedForm(cd?: CardData): LinkedFormState {
  const parsed = resolveTypeLine(cd?.typeLine);
  return {
    name: cd?.name ?? "",
    manaCost: cd?.manaCost ?? "",
    types: parsed.types,
    subtypes: parsed.subtypes.join(" "),
    faceTemplate: cd ? inferFaceTemplate(cd) : "",
    abilitiesText: extractAbilitiesText(cd?.abilities),
    power: cd?.power ?? "",
    toughness: cd?.toughness ?? "",
    startingLoyalty: cd?.startingLoyalty ?? "",
    battleDefense: cd?.battleDefense ?? "",
    flavorText: cd?.flavorText ?? "",
    artDescription: cd?.artDescription ?? "",
  };
}

function LinkedCardEditor({ form, onChange, loading }: { form: LinkedFormState; onChange: (f: LinkedFormState) => void; loading: boolean }) {
  const setField = <K extends keyof LinkedFormState>(key: K, value: LinkedFormState[K]) => onChange({ ...form, [key]: value });
  const toggleType = (t: Type) => {
    const types = form.types.includes(t) ? form.types.filter((x) => x !== t) : [...form.types, t];
    onChange({ ...form, types });
  };

  return (
    <div className="space-y-4 p-3 border border-neutral-700 rounded-lg bg-neutral-900/50">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-neutral-400 mb-1">Name</label>
          <input className="input" value={form.name} onChange={(e) => setField("name", e.target.value)} placeholder="Back face name" disabled={loading} />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-400 mb-1">Mana Cost</label>
          <input className="input font-mono" value={form.manaCost} onChange={(e) => setField("manaCost", e.target.value)} placeholder="{2}{R}" disabled={loading} />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-400 mb-1">Face Template</label>
          <select className="input" value={form.faceTemplate} onChange={(e) => setField("faceTemplate", e.target.value as FaceTemplate)} disabled={loading}>
            {FACE_TEMPLATES.map(({ label, value }) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-400 mb-1">Types</label>
        <div className="flex flex-wrap gap-1.5">
          {CARD_TYPES.map((t) => (
            <button key={t} type="button" onClick={() => toggleType(t as Type)} disabled={loading}
              className={`px-2 py-0.5 rounded text-xs transition-colors ${form.types.includes(t as Type) ? "bg-gold-500 text-neutral-950 font-semibold" : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"}`}>
              {capitalize(t)}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-400 mb-1">Subtypes</label>
        <input className="input" value={form.subtypes} onChange={(e) => setField("subtypes", e.target.value)} placeholder="Human Wizard" disabled={loading} />
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-400 mb-1">Abilities</label>
        <textarea className="input w-full resize-none" rows={3} value={form.abilitiesText} onChange={(e) => setField("abilitiesText", e.target.value)} placeholder="Card abilities" disabled={loading} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-medium text-neutral-400 mb-1">Power</label>
          <input className="input" value={form.power} onChange={(e) => setField("power", e.target.value)} disabled={loading} />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-400 mb-1">Toughness</label>
          <input className="input" value={form.toughness} onChange={(e) => setField("toughness", e.target.value)} disabled={loading} />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-400 mb-1">Loyalty</label>
          <input className="input" value={form.startingLoyalty} onChange={(e) => setField("startingLoyalty", e.target.value)} disabled={loading} />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-400 mb-1">Defense</label>
          <input className="input" value={form.battleDefense} onChange={(e) => setField("battleDefense", e.target.value)} disabled={loading} />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-400 mb-1">Flavor Text</label>
        <textarea className="input w-full resize-none" rows={2} value={form.flavorText} onChange={(e) => setField("flavorText", e.target.value)} disabled={loading} />
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-400 mb-1">Art Description</label>
        <textarea className="input w-full resize-none" rows={2} value={form.artDescription} onChange={(e) => setField("artDescription", e.target.value)} disabled={loading} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Build CardData from form state
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
  artUrl: string;
  // Layout & template
  layout: Layout;
  faceTemplate: FaceTemplate;
  // Visual overrides
  frameColor: FrameColor | "";
  accentColor: AccentColor | "";
  frameEffect: FrameEffect | "";
  colorIndicator: Color[];
  legendCrown: boolean | "";
  nameLineColor: FrameColor | "";
  typeLineColor: FrameColor | "";
  ptBoxColor: FrameColor | "";
  // Metadata
  artist: string;
  setCode: string;
  collectorNumber: string;
  designer: string;
}

function linkedFormToCardData(linked: LinkedFormState): CardData {
  const subtypes = linked.subtypes.split(/\s+/).map((s) => s.trim()).filter(Boolean);
  const isCreature = linked.types.includes("creature");
  const isPw = linked.types.includes("planeswalker");
  const isBattle = linked.types.includes("battle");
  const cd: CardData = {
    name: linked.name || undefined,
    manaCost: linked.manaCost || undefined,
    typeLine: { supertypes: [], types: linked.types, subtypes },
    cardTemplate: linked.faceTemplate ? linked.faceTemplate as TemplateName : undefined,
    abilities: linked.abilitiesText.trim() || undefined,
    power: isCreature && linked.power ? linked.power : undefined,
    toughness: isCreature && linked.toughness ? linked.toughness : undefined,
    startingLoyalty: isPw && linked.startingLoyalty ? linked.startingLoyalty : undefined,
    battleDefense: isBattle && linked.battleDefense ? linked.battleDefense : undefined,
    flavorText: linked.flavorText || undefined,
    artDescription: linked.artDescription || undefined,
  };
  return cd;
}

function buildCardData(form: FormState, linkedForm?: LinkedFormState, abilities?: CardData["abilities"]): CardData {
  const subtypes = form.subtypes.split(/\s+/).map((s) => s.trim()).filter(Boolean);
  const isCreature = form.types.includes("creature");
  const isPw = form.types.includes("planeswalker");
  const isBattle = form.types.includes("battle");
  const linkType = LAYOUT_TO_LINK_TYPE[form.layout];
  const hasLinked = !!linkType;

  const cd: CardData = {
    name: form.name || undefined,
    manaCost: form.manaCost || undefined,
    typeLine: { supertypes: form.supertypes, types: form.types, subtypes },
    rarity: form.rarity || undefined,
    abilities: abilities || form.abilitiesText.trim() || undefined,
    power: isCreature && form.power ? form.power : undefined,
    toughness: isCreature && form.toughness ? form.toughness : undefined,
    startingLoyalty: isPw && form.startingLoyalty ? form.startingLoyalty : undefined,
    battleDefense: isBattle && form.battleDefense ? form.battleDefense : undefined,
    flavorText: form.flavorText || undefined,
    artDescription: form.artDescription || undefined,
    artUrl: form.artUrl || undefined,
    // Template resolved from layout + face template
    cardTemplate: resolveFormTemplate(form.layout, form.faceTemplate),
    frameColor: form.frameColor || undefined,
    accentColor: form.accentColor || undefined,
    frameEffect: form.frameEffect || undefined,
    colorIndicator: form.colorIndicator.length ? form.colorIndicator : undefined,
    legendCrown: form.legendCrown === "" ? undefined : form.legendCrown,
    nameLineColor: form.nameLineColor || undefined,
    typeLineColor: form.typeLineColor || undefined,
    ptBoxColor: form.ptBoxColor || undefined,
    // Link — derived from layout
    linkType: linkType,
    linkedCard: hasLinked && linkedForm ? linkedFormToCardData(linkedForm) : undefined,
    // Metadata
    artist: form.artist || undefined,
    setCode: form.setCode || undefined,
    collectorNumber: form.collectorNumber || undefined,
    designer: form.designer || undefined,
  };

  return cd;
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
  const cd = initialCardData;

  const [form, setForm] = useState<FormState>(() => ({
    name: cd.name ?? "",
    manaCost: cd.manaCost ?? "",
    supertypes: resolveTypeLine(cd.typeLine).supertypes,
    types: resolveTypeLine(cd.typeLine).types,
    subtypes: resolveTypeLine(cd.typeLine).subtypes.join(" "),
    rarity: cd.rarity ?? "common",
    abilitiesText: extractAbilitiesText(cd.abilities),
    power: cd.power ?? "",
    toughness: cd.toughness ?? "",
    startingLoyalty: cd.startingLoyalty ?? "",
    battleDefense: cd.battleDefense ?? "",
    flavorText: cd.flavorText ?? "",
    artDescription: cd.artDescription ?? "",
    artUrl: cd.artUrl ?? "",
    layout: inferLayout(cd),
    faceTemplate: inferFaceTemplate(cd),
    frameColor: (Array.isArray(cd.frameColor) ? cd.frameColor[0] : cd.frameColor) ?? "",
    accentColor: (Array.isArray(cd.accentColor) ? cd.accentColor[0] : cd.accentColor) ?? "",
    frameEffect: (Array.isArray(cd.frameEffect) ? cd.frameEffect[0] : cd.frameEffect) ?? "",
    colorIndicator: cd.colorIndicator ?? [],
    legendCrown: cd.legendCrown ?? "",
    nameLineColor: (Array.isArray(cd.nameLineColor) ? cd.nameLineColor[0] : cd.nameLineColor) ?? "",
    typeLineColor: (Array.isArray(cd.typeLineColor) ? cd.typeLineColor[0] : cd.typeLineColor) ?? "",
    ptBoxColor: (Array.isArray(cd.ptBoxColor) ? cd.ptBoxColor[0] : cd.ptBoxColor) ?? "",
    artist: cd.artist ?? "",
    setCode: cd.setCode ?? "",
    collectorNumber: cd.collectorNumber ?? "",
    designer: cd.designer ?? "",
  }));

  const [linkedForm, setLinkedForm] = useState<LinkedFormState>(() => initLinkedForm(cd.linkedCard));

  // Structured editor state
  const [useStructuredEditor, setUseStructuredEditor] = useState(false);
  const structuredKind = useMemo(
    () => detectStructuredKind(form.types, form.subtypes, form.faceTemplate),
    [form.types, form.subtypes, form.faceTemplate],
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
  const [levelerLevels, setLevelerLevels] = useState<LevelerLevel[]>(() =>
    parseLevelerLevels(structuredKind === "leveler" ? form.abilitiesText : ""),
  );
  const [caseState, setCaseState] = useState<CaseState>(() =>
    parseCaseState(structuredKind === "case" ? form.abilitiesText : ""),
  );
  const [prototypeState, setPrototypeState] = useState<PrototypeState>(() =>
    parsePrototypeState(structuredKind === "prototype" ? form.abilitiesText : ""),
  );
  const [mutateCost, setMutateCost] = useState(() => {
    if (structuredKind !== "mutate") return "";
    const m = form.abilitiesText.match(/Mutate\s+(.+)/i);
    return m?.[1] ?? "";
  });

  // Sync structured editors -> abilitiesText
  const updateAbilitiesFromStructured = useCallback(
    (kind: StructuredKind) => {
      if (!kind || !useStructuredEditor) return;
      let text = "";
      switch (kind) {
        case "planeswalker": text = formatPlaneswalkerAbilities(pwAbilities); break;
        case "saga": text = formatSagaChapters(sagaChapters); break;
        case "class": text = formatClassLevels(classLevels); break;
        case "leveler": text = formatLevelerLevels(levelerLevels); break;
        case "case": text = formatCaseState(caseState); break;
        case "prototype": text = formatPrototypeState(prototypeState); break;
        case "mutate": text = mutateCost ? `Mutate ${mutateCost}` : ""; break;
      }
      setForm((f) => ({ ...f, abilitiesText: text }));
    },
    [useStructuredEditor, pwAbilities, sagaChapters, classLevels, levelerLevels, caseState, prototypeState, mutateCost],
  );

  useEffect(() => {
    updateAbilitiesFromStructured(structuredKind);
  }, [updateAbilitiesFromStructured, structuredKind]);

  const toggleStructuredEditor = useCallback(() => {
    if (!useStructuredEditor && structuredKind) {
      switch (structuredKind) {
        case "planeswalker": setPwAbilities(parsePlaneswalkerAbilities(form.abilitiesText)); break;
        case "saga": setSagaChapters(parseSagaChapters(form.abilitiesText)); break;
        case "class": setClassLevels(parseClassLevels(form.abilitiesText)); break;
        case "leveler": setLevelerLevels(parseLevelerLevels(form.abilitiesText)); break;
        case "case": setCaseState(parseCaseState(form.abilitiesText)); break;
        case "prototype": setPrototypeState(parsePrototypeState(form.abilitiesText)); break;
        case "mutate": {
          const m = form.abilitiesText.match(/Mutate\s+(.+)/i);
          setMutateCost(m?.[1] ?? "");
          break;
        }
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
      supertypes: f.supertypes.includes(st) ? f.supertypes.filter((s) => s !== st) : [...f.supertypes, st],
    }));
  };

  const toggleType = (t: Type) => {
    setForm((f) => ({
      ...f,
      types: f.types.includes(t) ? f.types.filter((x) => x !== t) : [...f.types, t],
    }));
  };

  const toggleColorIndicator = (c: Color) => {
    setForm((f) => ({
      ...f,
      colorIndicator: f.colorIndicator.includes(c) ? f.colorIndicator.filter((x) => x !== c) : [...f.colorIndicator, c],
    }));
  };

  const hasLinkedCard = form.layout !== "single";

  // Build structured ParsedAbilities when using structured editor, otherwise use text string
  const resolvedAbilities = useMemo((): CardData["abilities"] => {
    if (!useStructuredEditor || !structuredKind) return form.abilitiesText.trim() || undefined;
    switch (structuredKind) {
      case "planeswalker":
        return { structuredAbilities: { kind: "planeswalker", loyaltyAbilities: pwAbilities } };
      case "saga":
        return { structuredAbilities: { kind: "saga", chapters: sagaChapters } };
      case "class":
        return { structuredAbilities: { kind: "class", classLevels: classLevels } };
      case "leveler":
        return { structuredAbilities: { kind: "leveler", creatureLevels: levelerLevels.map((lv) => ({ level: [parseInt(lv.levelLo) || 0, parseInt(lv.levelHi) || 0], rulesText: lv.rulesText, power: lv.power, toughness: lv.toughness })) } };
      case "case":
        return { structuredAbilities: { kind: "case", caseConditions: caseState } };
      case "prototype":
        return { structuredAbilities: { kind: "prototype", prototype: prototypeState } };
      case "mutate":
        return { structuredAbilities: { kind: "mutate", mutateCost: mutateCost } };
      default:
        return form.abilitiesText.trim() || undefined;
    }
  }, [useStructuredEditor, structuredKind, form.abilitiesText, pwAbilities, sagaChapters, classLevels, levelerLevels, caseState, prototypeState, mutateCost]);

  const cardData = useMemo(
    () => buildCardData(form, hasLinkedCard ? linkedForm : undefined, resolvedAbilities),
    [form, linkedForm, hasLinkedCard, resolvedAbilities],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!loading) onSave(cardData);
  };

  // Show P/T if creature type selected
  const showPT = form.types.includes("creature");
  const showLoyalty = form.types.includes("planeswalker") || structuredKind === "planeswalker";
  const showDefense = form.types.includes("battle");

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Name & Mana Cost */}
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

      {/* Supertypes */}
      <div>
        <label className="block text-sm font-medium text-neutral-300 mb-1">Supertypes</label>
        <div className="flex flex-wrap gap-2">
          {SUPERTYPES.map((st) => (
            <button key={st} type="button" onClick={() => toggleSupertype(st)} disabled={loading}
              className={`px-3 py-1 rounded text-sm transition-colors ${form.supertypes.includes(st) ? "bg-gold-500 text-neutral-950 font-semibold" : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"}`}>
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
            <button key={t} type="button" onClick={() => toggleType(t as Type)} disabled={loading}
              className={`px-3 py-1 rounded text-sm transition-colors ${form.types.includes(t as Type) ? "bg-gold-500 text-neutral-950 font-semibold" : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"}`}>
              {capitalize(t)}
            </button>
          ))}
        </div>
      </div>

      {/* Subtypes */}
      <div>
        <label className="block text-sm font-medium text-neutral-300 mb-1">Subtypes</label>
        <input className="input" value={form.subtypes} onChange={(e) => setField("subtypes", e.target.value)} placeholder="Human Wizard" disabled={loading} />
      </div>

      {/* Layout, Face Template & Rarity */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-neutral-300 mb-1">Layout</label>
          <select className="input" value={form.layout} onChange={(e) => setField("layout", e.target.value as Layout)} disabled={loading}>
            {LAYOUT_OPTIONS.map(({ label, value }) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-300 mb-1">Face Template</label>
          <select className="input" value={form.faceTemplate} onChange={(e) => setField("faceTemplate", e.target.value as FaceTemplate)} disabled={loading}>
            {FACE_TEMPLATES.map(({ label, value }) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-300 mb-1">Rarity</label>
          <select className="input" value={form.rarity} onChange={(e) => setField("rarity", e.target.value as Rarity)} disabled={loading}>
            {RARITIES.map((r) => <option key={r} value={r}>{capitalize(r)}</option>)}
          </select>
        </div>
      </div>

      {/* Abilities */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-sm font-medium text-neutral-300">Abilities</label>
          {structuredKind && (
            <button type="button" onClick={toggleStructuredEditor} className="text-xs text-gold-400 hover:text-gold-300 transition-colors">
              {useStructuredEditor ? "Switch to text editor" : `Switch to ${structuredKind} editor`}
            </button>
          )}
        </div>

        {useStructuredEditor && structuredKind === "planeswalker" ? (
          <PlaneswalkerEditor abilities={pwAbilities} onChange={setPwAbilities} />
        ) : useStructuredEditor && structuredKind === "saga" ? (
          <SagaEditor chapters={sagaChapters} onChange={setSagaChapters} />
        ) : useStructuredEditor && structuredKind === "class" ? (
          <ClassEditor levels={classLevels} onChange={setClassLevels} />
        ) : useStructuredEditor && structuredKind === "leveler" ? (
          <LevelerEditor levels={levelerLevels} onChange={setLevelerLevels} />
        ) : useStructuredEditor && structuredKind === "case" ? (
          <CaseEditor state={caseState} onChange={setCaseState} />
        ) : useStructuredEditor && structuredKind === "prototype" ? (
          <PrototypeEditor state={prototypeState} onChange={setPrototypeState} />
        ) : useStructuredEditor && structuredKind === "mutate" ? (
          <MutateEditor cost={mutateCost} onChange={setMutateCost} />
        ) : (
          <textarea className="input w-full resize-none" rows={5} value={form.abilitiesText} onChange={(e) => setField("abilitiesText", e.target.value)} placeholder="Card abilities text (one ability per line)" disabled={loading} />
        )}
      </div>

      {/* Stats: P/T, Loyalty, Defense — show contextually */}
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

      {/* Flavor Text */}
      <div>
        <label className="block text-sm font-medium text-neutral-300 mb-1">Flavor Text</label>
        <textarea className="input w-full resize-none" rows={2} value={form.flavorText} onChange={(e) => setField("flavorText", e.target.value)} placeholder="Italic flavor text..." disabled={loading} />
      </div>

      {/* Art Description & URL */}
      <div>
        <label className="block text-sm font-medium text-neutral-300 mb-1">Art Description</label>
        <textarea className="input w-full resize-none" rows={2} value={form.artDescription} onChange={(e) => setField("artDescription", e.target.value)} placeholder="Describe the card art..." disabled={loading} />
      </div>
      <div>
        <label className="block text-sm font-medium text-neutral-300 mb-1">Art URL</label>
        <input className="input" value={form.artUrl} onChange={(e) => setField("artUrl", e.target.value)} placeholder="https://..." disabled={loading} />
      </div>

      {/* Linked Card — shown when layout has multiple faces */}
      {hasLinkedCard && (
        <details className="border border-neutral-800 rounded-lg" open>
          <summary className="px-4 py-2 cursor-pointer text-sm font-medium text-neutral-400 hover:text-neutral-300 transition-colors select-none">
            {form.layout === "adventure" ? "Adventure Spell" : "Back Face"} ({form.layout})
          </summary>
          <div className="px-4 pb-4 pt-2 space-y-3">
            <LinkedCardEditor form={linkedForm} onChange={setLinkedForm} loading={loading} />
          </div>
        </details>
      )}

      {/* Visual Overrides */}
      <details className="border border-neutral-800 rounded-lg">
        <summary className="px-4 py-2 cursor-pointer text-sm font-medium text-neutral-400 hover:text-neutral-300 transition-colors select-none">
          Visual Overrides
        </summary>
        <div className="px-4 pb-4 pt-2 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-neutral-300 mb-1">Frame Color</label>
              <select className="input" value={form.frameColor} onChange={(e) => setField("frameColor", e.target.value as FrameColor | "")} disabled={loading}>
                <option value="">Auto-detect</option>
                {FRAME_COLORS.map((c) => <option key={c} value={c}>{capitalize(c)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-300 mb-1">Accent Color</label>
              <select className="input" value={form.accentColor} onChange={(e) => setField("accentColor", e.target.value as AccentColor | "")} disabled={loading}>
                <option value="">None</option>
                {FRAME_COLORS.map((c) => <option key={c} value={c}>{capitalize(c)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-300 mb-1">Frame Effect</label>
              <select className="input" value={form.frameEffect} onChange={(e) => setField("frameEffect", e.target.value as FrameEffect | "")} disabled={loading}>
                <option value="">Normal</option>
                {FRAME_EFFECTS.map((f) => <option key={f} value={f}>{capitalize(f)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-300 mb-1">Name Line Color</label>
              <select className="input" value={form.nameLineColor} onChange={(e) => setField("nameLineColor", e.target.value as FrameColor | "")} disabled={loading}>
                <option value="">Auto</option>
                {FRAME_COLORS.map((c) => <option key={c} value={c}>{capitalize(c)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-300 mb-1">Type Line Color</label>
              <select className="input" value={form.typeLineColor} onChange={(e) => setField("typeLineColor", e.target.value as FrameColor | "")} disabled={loading}>
                <option value="">Auto</option>
                {FRAME_COLORS.map((c) => <option key={c} value={c}>{capitalize(c)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-300 mb-1">P/T Box Color</label>
              <select className="input" value={form.ptBoxColor} onChange={(e) => setField("ptBoxColor", e.target.value as FrameColor | "")} disabled={loading}>
                <option value="">Auto</option>
                {FRAME_COLORS.map((c) => <option key={c} value={c}>{capitalize(c)}</option>)}
              </select>
            </div>
          </div>
          {/* Color Indicator */}
          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-1">Color Indicator</label>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button key={c} type="button" onClick={() => toggleColorIndicator(c)} disabled={loading}
                  className={`px-3 py-1 rounded text-sm transition-colors ${form.colorIndicator.includes(c) ? "bg-gold-500 text-neutral-950 font-semibold" : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"}`}>
                  {capitalize(c)}
                </button>
              ))}
            </div>
          </div>
          {/* Legend Crown */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-neutral-300">Legend Crown</label>
            <select className="input w-32" value={form.legendCrown === "" ? "" : form.legendCrown ? "yes" : "no"} onChange={(e) => setField("legendCrown", e.target.value === "" ? "" : e.target.value === "yes")} disabled={loading}>
              <option value="">Auto</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </div>
        </div>
      </details>

      {/* Metadata */}
      <details className="border border-neutral-800 rounded-lg">
        <summary className="px-4 py-2 cursor-pointer text-sm font-medium text-neutral-400 hover:text-neutral-300 transition-colors select-none">
          Metadata
        </summary>
        <div className="px-4 pb-4 pt-2 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-neutral-300 mb-1">Artist</label>
              <input className="input" value={form.artist} onChange={(e) => setField("artist", e.target.value)} placeholder="Artist name" disabled={loading} />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-300 mb-1">Set Code</label>
              <input className="input font-mono" value={form.setCode} onChange={(e) => setField("setCode", e.target.value)} placeholder="CRU" disabled={loading} />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-300 mb-1">Collector Number</label>
              <input className="input font-mono" value={form.collectorNumber} onChange={(e) => setField("collectorNumber", e.target.value)} placeholder="000" disabled={loading} />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-300 mb-1">Designer</label>
              <input className="input" value={form.designer} onChange={(e) => setField("designer", e.target.value)} placeholder="Designer name" disabled={loading} />
            </div>
          </div>
        </div>
      </details>

      {/* Preview */}
      <details className="border border-neutral-800 rounded-lg">
        <summary className="px-4 py-2 cursor-pointer text-sm font-medium text-neutral-400 hover:text-neutral-300 transition-colors select-none">
          Preview CardData
        </summary>
        <div className="px-4 pb-4 pt-2">
          <pre className="text-sm text-neutral-300 bg-neutral-900 p-3 rounded-lg whitespace-pre-wrap font-mono leading-relaxed overflow-x-auto">
            {JSON.stringify(cardData, null, 2)}
          </pre>
        </div>
      </details>

      {/* Submit */}
      <div className="flex gap-3">
        <button type="submit" disabled={loading}
          className="px-6 py-2.5 bg-gold-500 text-neutral-950 font-semibold rounded-lg hover:bg-gold-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
          {loading ? "Saving..." : "Save & Re-render"}
        </button>
      </div>
    </form>
  );
}
