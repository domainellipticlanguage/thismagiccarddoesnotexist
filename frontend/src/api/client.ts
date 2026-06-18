import type { BugReport, Card, CardData, CardResponse } from "../types/card";

const API_BASE = "/api";

export interface CardsPage {
  cards: Card[];
  nextCursor?: string;
}

/** One page of gallery cards, newest first. Pass the previous page's
 *  `nextCursor` to fetch the next page; an absent cursor means exhausted. */
export async function fetchCardsPage(cursor?: string, limit = 60): Promise<CardsPage> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  const response = await fetch(`${API_BASE}/cards?${params}`);
  if (!response.ok) throw new Error("Failed to fetch cards");
  const data = await response.json();
  return { cards: data.cards, nextCursor: data.nextCursor };
}

export async function fetchCard(id: string): Promise<CardResponse> {
  const response = await fetch(`${API_BASE}/cards/${id}`);
  if (!response.ok) throw new Error("Failed to fetch card");
  return response.json();
}

export async function deleteCard(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/cards/${id}`, { method: "DELETE" });
  if (!response.ok) throw new Error("Failed to delete card");
}

/** A card's current bug report (or null). The card object never carries this —
 *  it's a separate, mutable resource — so the button reads it directly. */
export async function fetchBugReport(id: string): Promise<BugReport | null> {
  const response = await fetch(`${API_BASE}/cards/${id}/bug`);
  if (!response.ok) return null;
  return (await response.json()).bugReport ?? null;
}

/** Report a rendering bug on a card. `text` is an optional explanation. A new
 *  report overwrites any previous one. Returns the saved report. */
export async function reportBug(id: string, text: string): Promise<BugReport> {
  const response = await fetch(`${API_BASE}/cards/${id}/bug`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to report bug");
  }
  return (await response.json()).bugReport;
}

export async function editCardFields(
  id: string,
  cardData: CardData,
  mode: "edit" | "copy" = "edit"
): Promise<string> {
  const response = await fetch(`${API_BASE}/cards/${id}/edit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cardData, mode }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to save edits");
  }
  return (await response.json()).card_id;
}

/** Manual create: persist a brand-new card from form fields (no LLM). Returns
 *  the new card id. A face with an empty art description renders an empty box. */
export async function createManualCard(cardData: CardData): Promise<string> {
  const response = await fetch(`${API_BASE}/cards/manual`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cardData }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to create card");
  }
  return (await response.json()).card_id;
}

export async function createCard(
  description: string,
  base: string | null = null,
  mode: "create" | "edit" | "copy" = "create"
): Promise<CardResponse> {
  const response = await fetch(`${API_BASE}/cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description, base, mode }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to create card");
  }
  if (!response.body) throw new Error("Response has no body");

  // The server streams a single newline-terminated JSON line containing
  // the full CardResponse, then keeps the stream open while it persists
  // to S3/DDB. We resolve as soon as that line is complete so the caller
  // doesn't wait for persistence.
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex >= 0) {
        const parsed = JSON.parse(buffer.slice(0, newlineIndex));
        if (parsed.error) throw new Error(parsed.error);
        return parsed as CardResponse;
      }
      if (done) break;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  throw new Error("Stream ended without a complete response");
}
