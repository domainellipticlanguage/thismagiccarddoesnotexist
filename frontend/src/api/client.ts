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
): Promise<string> {
  const response = await fetch(`${API_BASE}/cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description, base, mode }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to create card");
  }
  return (await response.json()).card_id;
}
