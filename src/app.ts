import { Hono } from "hono";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import path from "path";
import { fileURLToPath } from "url";
import { readFileSync, readdirSync, existsSync, statSync } from "fs";
import {
  getCard,
  getLatestCards,
  softDeleteCard,
} from "./card-table.js";
import { generateCard } from "./card-generator.js";
import { buildDisplay } from "./card-renderer.js";
import type {
  CreateCardRequest,
  CardResponse,
} from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const app = new Hono();

function getCreatorId(c: Context): string {
  return (
    getCookie(c, "user_id") ||
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    "anonymous"
  );
}

function isDebug(): boolean {
  return process.env.IS_DEBUG === "true";
}

// --- API Routes ---

app.get("/api/cards", async (c) => {
  try {
    const limit = parseInt(c.req.query("limit") || "300", 10);
    const cards = await getLatestCards(limit);
    const cardsWithDisplay = cards.map((card) => ({
      ...card,
      display: buildDisplay(card),
    }));
    return c.json({ cards: cardsWithDisplay });
  } catch (err: any) {
    console.error("[API] GET /api/cards error:", err);
    return c.json({ error: err.message }, 500);
  }
});

app.get("/api/cards/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const card = await getCard(id);
    if (!card) return c.json({ error: "Card not found" }, 404);

    const creatorId = getCreatorId(c);
    const canEdit = isDebug() || card.creatorId === creatorId;

    card.display = buildDisplay(card);

    const response: CardResponse = { card, canEdit, canDelete: canEdit };
    return c.json(response);
  } catch (err: any) {
    console.error("[API] GET /api/cards/:id error:", err);
    return c.json({ error: err.message }, 500);
  }
});

app.delete("/api/cards/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const card = await getCard(id);
    if (!card) return c.json({ error: "Card not found" }, 404);

    const creatorId = getCreatorId(c);
    if (!isDebug() && card.creatorId !== creatorId) {
      return c.json({ error: "Not authorized" }, 403);
    }

    await softDeleteCard(id);
    return c.json({ success: true });
  } catch (err: any) {
    console.error("[API] DELETE error:", err);
    return c.json({ error: err.message }, 500);
  }
});

app.post("/api/cards", async (c) => {
  try {
    const body = (await c.req.json()) as CreateCardRequest;
    if (!body.description) {
      return c.json({ error: "description is required" }, 400);
    }

    const creatorId = getCreatorId(c);
    const card = await generateCard(
      body.description,
      body.base,
      creatorId,
      body.mode || "create"
    );
    return c.json({ card_id: card.id });
  } catch (err: any) {
    console.error("[API] POST create error:", err);
    return c.json({ error: err.message }, 500);
  }
});

// --- Eval results API (dev only) ---

const evalDir = path.resolve(__dirname, "..", "eval");

app.get("/api/eval/results", (c) => {
  const f = path.join(evalDir, "results.json");
  if (!existsSync(f)) return c.json([]);
  return c.json(JSON.parse(readFileSync(f, "utf-8")));
});

app.get("/api/eval/scores", (c) => {
  const f = path.join(evalDir, "scores.json");
  if (!existsSync(f)) return c.json([]);
  return c.json(JSON.parse(readFileSync(f, "utf-8")));
});

app.get("/api/eval/system-prompts", (c) => {
  const f = path.join(evalDir, "..", "src", "llm-client.ts");
  if (!existsSync(f)) return c.json({});
  const src = readFileSync(f, "utf-8");
  const prompts: Record<string, string> = {};
  const re = /(\w+):\s*`([\s\S]*?)`/g;
  let m;
  const objMatch = src.match(/export const SYSTEM_PROMPTS\s*=\s*\{([\s\S]*?)\n\};/);
  if (objMatch) {
    while ((m = re.exec(objMatch[1])) !== null) {
      prompts[m[1]] = m[2];
    }
  }
  return c.json(prompts);
});

app.get("/api/eval/prompts", (c) => {
  const f = path.join(evalDir, "prompts.ts");
  if (!existsSync(f)) return c.json({});
  const src = readFileSync(f, "utf-8");
  const meta: Record<string, { prompt: string; mode: string; criteria: string; originalCardText?: string }> = {};
  const re = /id:\s*"([^"]+)"[\s\S]*?prompt:\s*"([\s\S]*?)"[\s\S]*?mode:\s*"([^"]+)"[\s\S]*?criteria:\s*"([\s\S]*?)"/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    meta[m[1]] = { prompt: m[2], mode: m[3], criteria: m[4] };
  }
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
  return c.json(meta);
});

app.get("/api/eval/judge-results", (c) => {
  const dir = path.join(evalDir, "judge_results");
  if (!existsSync(dir)) return c.json({});
  const out: Record<string, unknown> = {};
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    out[file.replace(".json", "")] = JSON.parse(readFileSync(path.join(dir, file), "utf-8"));
  }
  return c.json(out);
});

app.get("/api/eval/batches", (c) => {
  const dir = path.join(evalDir, "judge_batches");
  if (!existsSync(dir)) return c.json({});
  const out: Record<string, unknown> = {};
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("_"))) {
    out[file.replace(".json", "")] = JSON.parse(readFileSync(path.join(dir, file), "utf-8"));
  }
  return c.json(out);
});

app.get("/eval", (c) => {
  const f = path.join(evalDir, "index.html");
  if (!existsSync(f)) return c.notFound();
  return c.html(readFileSync(f, "utf-8"));
});

// --- Static file serving (built React app) + SPA fallback ---

const staticRoot = process.env.LAMBDA_TASK_ROOT
  ? path.join(process.env.LAMBDA_TASK_ROOT, "frontend", "dist")
  : path.resolve(__dirname, "..", "frontend", "dist");

const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

app.get("*", (c) => {
  const reqPath = c.req.path === "/" ? "/index.html" : c.req.path;
  const filePath = path.normalize(path.join(staticRoot, reqPath));

  if (filePath.startsWith(staticRoot) && existsSync(filePath) && statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || "application/octet-stream";
    return new Response(readFileSync(filePath), {
      headers: { "Content-Type": contentType },
    });
  }

  // SPA fallback
  const indexPath = path.join(staticRoot, "index.html");
  if (existsSync(indexPath)) {
    return c.html(readFileSync(indexPath, "utf-8"));
  }
  return c.notFound();
});
