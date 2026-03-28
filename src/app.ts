import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import {
  getCard,
  getLatestCards,
  softDeleteCard,
} from "./card-table.js";
import { generateCard, applyFieldEdits } from "./card-generator.js";
import { buildDisplay } from "./card-renderer.js";
import { getPresignedUrl } from "./s3-storage.js";
import type {
  CardRecord,
  CreateCardRequest,
  EditCardFieldsRequest,
  CardResponse,
  CardsResponse,
} from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const app = express();
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
    // Build display objects with signed URLs for each card
    const cardsWithDisplay = await Promise.all(
      cards.map(async (card) => ({
        ...card,
        display: await buildDisplay(card),
      }))
    );
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

    // Build display with freshly signed URLs
    card.display = await buildDisplay(card);

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

app.post("/api/cards/:id/edit", async (req, res) => {
  try {
    const body = req.body as EditCardFieldsRequest;
    if (!body.crucibleText) {
      return res.status(400).json({ error: "crucibleText is required" });
    }

    const creatorId = getCreatorId(req);
    const newCard = await applyFieldEdits(req.params.id, body.crucibleText, creatorId);
    res.json({ card_id: newCard.id });
  } catch (err: any) {
    console.error("[API] POST edit error:", err);
    res.status(500).json({ error: err.message });
  }
});

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

// --- Static file serving (built React app) ---

const staticDir = path.resolve(__dirname, "..", "frontend", "dist");
app.use(express.static(staticDir));

// SPA fallback — serve index.html for all non-API routes
app.get("/{*path}", (_req, res) => {
  res.sendFile(path.join(staticDir, "index.html"));
});
