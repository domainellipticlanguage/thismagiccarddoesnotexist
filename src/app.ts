import { Hono } from "hono";
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { stream } from "hono/streaming";
import path from "path";
import { fileURLToPath } from "url";
import { readFileSync, readdirSync, existsSync, statSync } from "fs";
import {
  getCard,
  getCardsPage,
  softDeleteCard,
  getBugReport,
  setBugReport,
} from "./card-table.js";
import {
  generateRenderedCard,
  persistGeneratedCard,
  buildCardRecord,
  applyFieldEdits,
  createManualCard,
} from "./card-generator.js";
import { buildDisplay, stripArtUrl } from "./card-renderer.js";
import type {
  CreateCardRequest,
  CardResponse,
} from "./types.js";
import type { CardData } from "mtg-crucible";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type Env = { Variables: { creatorId: string } };

export const app = new Hono<Env>();

const CREATOR_COOKIE = "creator_id";

// Assign each visitor a stable, anonymous creator id via an HttpOnly cookie.
// Replaces the old IP-based identity — no personal data, and not readable or
// spoofable by client JS. Also stashed on the context so the request that first
// mints the id can use it immediately (the cookie only arrives on the next one).
app.use("*", async (c, next) => {
  const id = getCookie(c, CREATOR_COOKIE) || crypto.randomUUID();
  // Re-set on every request so the 400-day browser cap slides forward for
  // active visitors (effectively permanent unless they're away 400+ days or
  // clear storage). 400 days is the max Hono/browsers allow.
  setCookie(c, CREATOR_COOKIE, id, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 400,
    secure: !!process.env.LAMBDA_TASK_ROOT, // https in prod; http locally
  });
  c.set("creatorId", id);
  await next();
});

function getCreatorId(c: Context<Env>): string {
  return c.get("creatorId");
}

/** Drop the internal creator id before sending a card to the client. */
function publicCard<T extends { creatorId?: string }>(card: T): Omit<T, "creatorId"> {
  const { creatorId: _omit, ...rest } = card;
  return rest;
}

// Debug bypass for ownership checks. Deliberately LOCAL-ONLY: even with
// IS_DEBUG=true, it never engages inside Lambda (LAMBDA_TASK_ROOT is set there),
// so a stray flag in a deployed env can't silently make every card editable and
// deletable by anyone. Same prod signal the cookie's `secure` flag keys off.
function isDebug(): boolean {
  return process.env.IS_DEBUG === "true" && !process.env.LAMBDA_TASK_ROOT;
}

// --- API Routes ---

app.get("/api/cards", async (c) => {
  try {
    const limit = parseInt(c.req.query("limit") || "48", 10);
    const cursor = c.req.query("cursor") || undefined;
    const page = await getCardsPage({ limit, cursor });
    const cardsWithDisplay = page.cards.map((card) => ({
      ...publicCard(card),
      // Gallery renders the small low-q thumbnail for fast loads.
      display: buildDisplay(card, { thumbnail: true }),
    }));
    return c.json({ cards: cardsWithDisplay, nextCursor: page.nextCursor });
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

    // Older records baked the S3 art URL into crucibleText; strip it on read so
    // the Card Text box never shows it (new renders are already stripped).
    card.crucibleText = stripArtUrl(card.crucibleText);
    card.display = buildDisplay(card);

    const response: CardResponse = { card: publicCard(card), canEdit, canDelete: canEdit };
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

app.post("/api/cards/:id/edit", async (c) => {
  let body: { cardData?: CardData; mode?: "edit" | "copy" };
  try {
    body = (await c.req.json()) as { cardData?: CardData; mode?: "edit" | "copy" };
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (!body.cardData) return c.json({ error: "cardData is required" }, 400);
  const mode = body.mode === "copy" ? "copy" : "edit";

  try {
    const id = c.req.param("id");
    const original = await getCard(id);
    if (!original) return c.json({ error: "Card not found" }, 404);

    const creatorId = getCreatorId(c);
    // "copy" produces an independent new card and never mutates the original,
    // so (like the AI Copy & Remix path) it isn't gated on ownership. Only an
    // in-place "edit" requires the caller to own the card.
    if (mode === "edit" && !isDebug() && original.creatorId !== creatorId) {
      return c.json({ error: "Not authorized" }, 403);
    }

    const newCard = await applyFieldEdits(body.cardData, original, creatorId, mode);
    return c.json({ card_id: newCard.id });
  } catch (err: any) {
    console.error("[API] POST edit error:", err);
    return c.json({ error: err.message }, 500);
  }
});

// A card's current bug report (a separate item, so the card stays immutable).
// The 🐛 button reads this on mount; null means no report.
app.get("/api/cards/:id/bug", async (c) => {
  try {
    const bugReport = await getBugReport(c.req.param("id"));
    return c.json({ bugReport: bugReport ?? null });
  } catch (err: any) {
    console.error("[API] GET bug report error:", err);
    return c.json({ error: err.message }, 500);
  }
});

// Report a rendering bug on a card. Open to anyone (gallery is public); a new
// report overwrites the previous one.
app.post("/api/cards/:id/bug", async (c) => {
  let body: { text?: string };
  try {
    body = (await c.req.json()) as { text?: string };
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  try {
    const id = c.req.param("id");
    const card = await getCard(id);
    if (!card) return c.json({ error: "Card not found" }, 404);
    const bugReport = await setBugReport(id, (body.text || "").trim());
    return c.json({ bugReport });
  } catch (err: any) {
    console.error("[API] POST bug report error:", err);
    return c.json({ error: err.message }, 500);
  }
});

// Manual create: build a brand-new card from form fields with no LLM.
app.post("/api/cards/manual", async (c) => {
  let body: { cardData?: CardData };
  try {
    body = (await c.req.json()) as { cardData?: CardData };
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (!body.cardData) return c.json({ error: "cardData is required" }, 400);

  try {
    const creatorId = getCreatorId(c);
    const newCard = await createManualCard(body.cardData, creatorId);
    return c.json({ card_id: newCard.id });
  } catch (err: any) {
    console.error("[API] POST manual create error:", err);
    return c.json({ error: err.message }, 500);
  }
});

app.post("/api/cards", async (c) => {
  let body: CreateCardRequest;
  try {
    body = (await c.req.json()) as CreateCardRequest;
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (!body.description) {
    return c.json({ error: "description is required" }, 400);
  }

  const creatorId = getCreatorId(c);
  const mode = body.mode || "create";

  // An in-place AI edit supersedes the original card, so it requires ownership.
  // (Copy creates an independent new card and doesn't touch the original, so
  // it isn't gated — matching the manual edit path.) Checked before the stream
  // starts so we can return a real 403 rather than a mid-stream error.
  if (mode === "edit") {
    if (!body.base) return c.json({ error: "base card id is required" }, 400);
    const original = await getCard(body.base);
    if (!original) return c.json({ error: "Card not found" }, 404);
    if (!isDebug() && original.creatorId !== creatorId) {
      return c.json({ error: "Not authorized" }, 403);
    }
  }

  // The Designer cookie (set by the manual form) is sent with every request;
  // apply it implicitly to AI-generated cards too. Edits inherit the card's
  // existing designer, so it only takes effect on create.
  const designerCookie = getCookie(c, "designer") || undefined;

  // Stream the response so the client gets the rendered card as soon as
  // render completes — S3 upload + DDB write happen after the flush, while
  // the stream is still open. The client's perceived latency drops by the
  // duration of those writes.
  return stream(c, async (s) => {
    const reqStart = Date.now();
    try {
      const generated = await generateRenderedCard(
        body.description,
        body.base,
        creatorId,
        mode,
        designerCookie,
      );

      // Build the response card with data URLs so the client can render
      // the image immediately, before S3 has the persisted copy.
      const dataUrls = [
        `data:image/webp;base64,${generated.rendered.frontFace.toString("base64")}`,
      ];
      if (generated.rendered.backFace) {
        dataUrls.push(`data:image/webp;base64,${generated.rendered.backFace.toString("base64")}`);
      }
      const thumbDataUrls = [
        `data:image/webp;base64,${generated.thumbnail.frontFace.toString("base64")}`,
      ];
      if (generated.thumbnail.backFace) {
        thumbDataUrls.push(`data:image/webp;base64,${generated.thumbnail.backFace.toString("base64")}`);
      }
      const responseCard = buildCardRecord(generated, dataUrls, thumbDataUrls);
      const responsePayload: CardResponse = {
        card: publicCard({ ...responseCard, display: buildDisplay(responseCard) }),
        canEdit: true,
        canDelete: true,
      };

      // Newline-terminated so the client can detect end-of-payload without
      // waiting for the stream to close (which it won't until persistence
      // finishes).
      await s.write(JSON.stringify(responsePayload) + "\n");
      const flushedAt = Date.now();
      console.log(`[Request] flushed at ${((flushedAt - reqStart) / 1000).toFixed(2)}s`);

      // Persistence runs after the flush. The function stays alive (and
      // billed) until this resolves, but the client already has the card.
      await persistGeneratedCard(generated);
      console.log(`[Request] complete in ${((Date.now() - reqStart) / 1000).toFixed(2)}s (persist took ${((Date.now() - flushedAt) / 1000).toFixed(2)}s after flush)`);
    } catch (err: any) {
      console.error("[API] POST create error:", err);
      // Best-effort: report the error in the stream. If we already sent
      // the success payload the client will see this as a trailing line
      // and ignore it; if we failed before flushing, this is the only
      // signal the client gets.
      try {
        await s.write(JSON.stringify({ error: err.message }) + "\n");
      } catch {
        // Stream may already be torn down; nothing more we can do.
      }
    }
  });
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
  const m = src.match(/export const SYSTEM_PROMPT\s*=\s*`([\s\S]*?)`;/);
  return c.json(m ? { SYSTEM_PROMPT: m[1] } : {});
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
