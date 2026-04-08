import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { parseTypeLine } from "mtg-crucible";
import type { CardData } from "mtg-crucible";
import {
  getCard,
  getLatestCards,
  softDeleteCard,
} from "./card-table.js";
import { generateCard } from "./card-generator.js";
import { buildDisplay } from "./card-renderer.js";
import type {
  CreateCardRequest,
  CardDocument,
  CardResponse,
  CardsResponse,
} from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const app = express();

// serverless-http may pass body as a Buffer — convert before express.json() runs
app.use((req, _res, next) => {
  if (Buffer.isBuffer(req.body) && req.body.length > 0) {
    req.body = JSON.parse(req.body.toString());
  }
  next();
});
app.use(express.json());

// --- API Routes ---

function getCreatorId(req: express.Request): string {
  return req.cookies?.user_id || req.ip || "anonymous";
}

function isDebug(): boolean {
  return process.env.IS_DEBUG === "true";
}

// Simple cookie parsing (avoid cookie-parser dep)
app.use((req, _res, next) => {
  const cookieHeader = req.headers.cookie || "";
  req.cookies = Object.fromEntries(
    cookieHeader.split(";").map((c) => {
      const [k, ...v] = c.trim().split("=");
      return [k, v.join("=")];
    })
  );
  next();
});

app.get("/api/cards", async (_req, res) => {
  try {
    const limit = parseInt((_req.query.limit as string) || "300", 10);
    const cards = await getLatestCards(limit);
    const cardsWithDisplay = cards.map((card) => ({
      ...card,
      display: buildDisplay(card),
    }));
    res.json({ cards: cardsWithDisplay });
  } catch (err: any) {
    console.error("[API] GET /api/cards error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/cards/:id", async (req, res) => {
  try {
    const card = await getCard(req.params.id);
    if (!card) return res.status(404).json({ error: "Card not found" });

    const creatorId = getCreatorId(req);
    const canEdit = isDebug() || card.creatorId === creatorId;

    card.display = buildDisplay(card);

    const response: CardResponse = { card, canEdit, canDelete: canEdit };
    res.json(response);
  } catch (err: any) {
    console.error("[API] GET /api/cards/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/cards/:id", async (req, res) => {
  try {
    const card = await getCard(req.params.id);
    if (!card) return res.status(404).json({ error: "Card not found" });

    const creatorId = getCreatorId(req);
    if (!isDebug() && card.creatorId !== creatorId) {
      return res.status(403).json({ error: "Not authorized" });
    }

    await softDeleteCard(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    console.error("[API] DELETE error:", err);
    res.status(500).json({ error: err.message });
  }
});

// MVP: advanced field editing disabled — AI edits only
// app.post("/api/cards/:id/edit", async (req, res) => { ... });

app.post("/api/cards", async (req, res) => {
  try {
    const body = req.body as CreateCardRequest;
    if (!body.description) {
      return res.status(400).json({ error: "description is required" });
    }

    const creatorId = getCreatorId(req);
    const card = await generateCard(
      body.description,
      body.base,
      creatorId,
      body.mode || "create"
    );
    res.json({ card_id: card.id });
  } catch (err: any) {
    console.error("[API] POST create error:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- Eval results API (dev only) ---

import { readFileSync, readdirSync, existsSync } from "fs";

const evalDir = path.resolve(__dirname, "..", "eval");

app.get("/api/eval/results", (_req, res) => {
  const f = path.join(evalDir, "results.json");
  if (!existsSync(f)) return res.json([]);
  res.json(JSON.parse(readFileSync(f, "utf-8")));
});

app.get("/api/eval/scores", (_req, res) => {
  const f = path.join(evalDir, "scores.json");
  if (!existsSync(f)) return res.json([]);
  res.json(JSON.parse(readFileSync(f, "utf-8")));
});

app.get("/api/eval/system-prompts", (_req, res) => {
  // Dynamic import won't work easily, just read the source and extract
  const f = path.join(evalDir, "..", "src", "llm-client.ts");
  if (!existsSync(f)) return res.json({});
  const src = readFileSync(f, "utf-8");
  const prompts: Record<string, string> = {};
  const re = /(\w+):\s*`([\s\S]*?)`/g;
  let m;
  // Find the SYSTEM_PROMPTS object
  const objMatch = src.match(/export const SYSTEM_PROMPTS\s*=\s*\{([\s\S]*?)\n\};/);
  if (objMatch) {
    while ((m = re.exec(objMatch[1])) !== null) {
      prompts[m[1]] = m[2];
    }
  }
  res.json(prompts);
});

app.get("/api/eval/prompts", (_req, res) => {
  // Parse test metadata from prompts.ts
  const f = path.join(evalDir, "prompts.ts");
  if (!existsSync(f)) return res.json({});
  const src = readFileSync(f, "utf-8");
  const meta: Record<string, { prompt: string; mode: string; criteria: string; originalCardText?: string }> = {};
  // Extract test cases using regex
  const re = /id:\s*"([^"]+)"[\s\S]*?prompt:\s*"([\s\S]*?)"[\s\S]*?mode:\s*"([^"]+)"[\s\S]*?criteria:\s*"([\s\S]*?)"/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    meta[m[1]] = { prompt: m[2], mode: m[3], criteria: m[4] };
  }
  // Extract originalCardText references
  const cardTexts: Record<string, string> = {};
  const textRe = /const\s+(\w+)\s*=\s*`([\s\S]*?)`/g;
  let tm;
  while ((tm = textRe.exec(src)) !== null) {
    cardTexts[tm[1]] = tm[2];
  }
  const refRe = /id:\s*"([^"]+)"[\s\S]*?originalCardText:\s*(\w+)/g;
  let rm;
  while ((rm = refRe.exec(src)) !== null) {
    if (meta[rm[1]] && cardTexts[rm[2]]) {
      meta[rm[1]].originalCardText = cardTexts[rm[2]];
    }
  }
  res.json(meta);
});

app.get("/api/eval/judge-results", (_req, res) => {
  const dir = path.join(evalDir, "judge_results");
  if (!existsSync(dir)) return res.json({});
  const out: Record<string, unknown> = {};
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    out[file.replace(".json", "")] = JSON.parse(readFileSync(path.join(dir, file), "utf-8"));
  }
  res.json(out);
});

app.get("/api/eval/batches", (_req, res) => {
  const dir = path.join(evalDir, "judge_batches");
  if (!existsSync(dir)) return res.json({});
  const out: Record<string, unknown> = {};
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("_"))) {
    out[file.replace(".json", "")] = JSON.parse(readFileSync(path.join(dir, file), "utf-8"));
  }
  res.json(out);
});

app.get("/eval", (_req, res) => {
  res.sendFile(path.join(evalDir, "index.html"));
});

// --- Static file serving (built React app) ---

const staticDir = process.env.LAMBDA_TASK_ROOT
  ? path.resolve(process.env.LAMBDA_TASK_ROOT, "frontend", "dist")
  : path.resolve(__dirname, "..", "frontend", "dist");
app.use(express.static(staticDir));

// SPA fallback — serve index.html for all non-API routes
app.get("/{*path}", (_req, res) => {
  res.sendFile(path.join(staticDir, "index.html"));
});
