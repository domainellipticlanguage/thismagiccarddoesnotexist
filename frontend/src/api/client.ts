import type { Card, CardData, CardResponse } from "../types/card";

const API_BASE = "/api";

export async function fetchCards(limit = 300): Promise<Card[]> {
  const response = await fetch(`${API_BASE}/cards?limit=${limit}`);
  if (!response.ok) throw new Error("Failed to fetch cards");
  const data = await response.json();
  return data.cards;
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

export async function editCardFields(id: string, cardData: CardData): Promise<string> {
  const response = await fetch(`${API_BASE}/cards/${id}/edit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cardData }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to save edits");
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
