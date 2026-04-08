/**
 * Migrate cards from the old mtg_card (v2) DynamoDB table to the new v3 format.
 *
 * Usage:
 *   npx tsx scripts/migrate-v2.ts              # dry-run, sample 3 undeleted cards
 *   npx tsx scripts/migrate-v2.ts --write      # actually write to v3 table
 *   npx tsx scripts/migrate-v2.ts --all        # migrate all (dry-run)
 *   npx tsx scripts/migrate-v2.ts --all --write # migrate all and write
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { parseCard, renderCard, formatCard } from "mtg-crucible";
import type { CardData, Rotation } from "mtg-crucible";
import { uploadBuffer } from "../src/s3-storage.js";
import { v4 as uuid } from "uuid";
import dotenv from "dotenv";

dotenv.config();

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const V2_TABLE = "mtg_card";
const V3_TABLE = process.env.DYNAMODB_TABLE || "thismagiccarddoesnotexist3";

// ---------------------------------------------------------------------------
// V2 card shape
// ---------------------------------------------------------------------------

interface V2Card {
  id: string;
  card_name: string;
  mana_cost?: string;
  rules_text?: string;
  card_type: string;
  flavor_text?: string;
  rarity: string;
  power?: number;
  toughness?: number;
  art_description?: string;
  explanation?: string;
  loyalty?: number;
  super_type?: string;
  sub_type?: string;
  prompt?: string;
  art_url?: string;
  final_rendered_url?: string;
  is_deleted?: boolean;
  is_finished_generating?: boolean;
  is_superseded?: boolean;
  parent_id?: string;
  creator_id?: string;
  created_date?: string;
  sequence_number?: number;
}

// ---------------------------------------------------------------------------
// Convert v2 → v3
// ---------------------------------------------------------------------------

function buildTypeLine(v2: V2Card): string {
  const parts: string[] = [];
  if (v2.super_type) parts.push(v2.super_type);
  parts.push(v2.card_type);
  if (v2.sub_type) parts.push("—", v2.sub_type);
  return parts.join(" ");
}

/** Normalize mana cost: "2UU" → "{2}{U}{U}", "3BB" → "{3}{B}{B}" */
function normalizeManaCost(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  // Already in {X} format
  if (raw.includes("{")) return raw;
  // Parse: digits become {N}, letters become {L}
  return raw.replace(/(\d+|[WUBRGCXSP/]+)/gi, (match) => {
    // Hybrid like W/U → {W/U}
    if (match.includes("/")) return `{${match.toUpperCase()}}`;
    // Number
    if (/^\d+$/.test(match)) return `{${match}}`;
    // Individual color letters
    return match.split("").map((c) => `{${c.toUpperCase()}}`).join("");
  });
}

function mapRarity(r: string): string {
  const map: Record<string, string> = {
    "Common": "common",
    "Uncommon": "uncommon",
    "Rare": "rare",
    "Mythic Rare": "mythic",
    "Mythic": "mythic",
  };
  return map[r] || r.toLowerCase();
}

function v2ToCardData(v2: V2Card): CardData {
  const data: CardData = {
    name: v2.card_name,
    manaCost: normalizeManaCost(v2.mana_cost),
    typeLine: buildTypeLine(v2),
    abilities: v2.rules_text || undefined,
    flavorText: v2.flavor_text || undefined,
    artDescription: v2.art_description || undefined,
    rarity: mapRarity(v2.rarity) as CardData["rarity"],
    artUrl: v2.art_url || undefined,
    artist: "Dall-E 3",
    designer: "thismagiccarddoesnotexist.com",
  };

  if (v2.power != null || v2.toughness != null) {
    data.power = String(v2.power ?? 0);
    data.toughness = String(v2.toughness ?? 0);
  }
  if (v2.loyalty != null) {
    data.startingLoyalty = String(v2.loyalty);
  }

  return data;
}

// ---------------------------------------------------------------------------
// Render and build v3 record
// ---------------------------------------------------------------------------

async function migrateCard(v2: V2Card, write: boolean): Promise<void> {
  console.log(`\n--- Migrating: ${v2.card_name} (${v2.id}) ---`);

  const cardData = v2ToCardData(v2);
  console.log("  CardData:", JSON.stringify(cardData, null, 2));

  // Render with crucible
  let renderedUrls: string[] = [];
  let crucibleText = "";
  let scryfallText = "";
  let scryfallJson = "";
  let rotations: Rotation[] = [];

  try {
    const rendered = await renderCard(cardData, { quality: "medium", format: "jpeg" });
    crucibleText = rendered.crucibleText;
    scryfallText = rendered.scryfallText;
    scryfallJson = rendered.scryfallJson;
    rotations = rendered.rotations;

    if (write) {
      const frontKey = `rendered/${uuid()}.jpg`;
      renderedUrls.push(await uploadBuffer(rendered.frontFace, frontKey));
      if (rendered.backFace) {
        const backKey = `rendered/${uuid()}-back.jpg`;
        renderedUrls.push(await uploadBuffer(rendered.backFace, backKey));
      }
    } else {
      renderedUrls = v2.final_rendered_url ? [v2.final_rendered_url] : [];
    }

    console.log("  Rendered OK, crucibleText length:", crucibleText.length);
  } catch (err: any) {
    console.error("  Render failed:", err.message);
    // Fall back — store without render
    crucibleText = formatCard(cardData);
    renderedUrls = v2.final_rendered_url ? [v2.final_rendered_url] : [];
  }

  const record = {
    id: v2.id,
    cardData,
    renderedUrls,
    crucibleText,
    scryfallText,
    scryfallJson,
    rotations,
    prompt: v2.prompt || "",
    explanation: v2.explanation || "",
    creatorId: v2.creator_id || "",
    parentId: v2.parent_id || undefined,
    createdDate: v2.created_date || new Date().toISOString(),
    isDeleted: v2.is_deleted ?? false,
    isFinished: v2.is_finished_generating ?? false,
    isSuperseded: v2.is_superseded ?? false,
  };

  console.log("  V3 record:", JSON.stringify({ ...record, cardData: "<omitted>", crucibleText: crucibleText.slice(0, 80) + "..." }, null, 2));

  if (write) {
    await client.send(new PutCommand({ TableName: V3_TABLE, Item: record }));
    console.log("  ✓ Written to", V3_TABLE);
  } else {
    console.log("  (dry-run, not written)");
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const all = args.includes("--all");
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limit = all ? undefined : (limitArg ? parseInt(limitArg.split("=")[1]) : 3);

  console.log(`Migrating from ${V2_TABLE} → ${V3_TABLE}`);
  console.log(`Mode: ${write ? "WRITE" : "DRY-RUN"}, Limit: ${limit ?? "all"}\n`);

  // Scan v2 table for undeleted, finished cards (paginate to collect enough)
  const cards: V2Card[] = [];
  let lastKey: Record<string, any> | undefined;

  while (true) {
    const result = await client.send(
      new ScanCommand({
        TableName: V2_TABLE,
        FilterExpression:
          "(attribute_not_exists(is_deleted) OR is_deleted = :false) AND is_finished_generating = :true AND (attribute_not_exists(is_superseded) OR is_superseded = :false)",
        ExpressionAttributeValues: {
          ":false": false,
          ":true": true,
        },
        ExclusiveStartKey: lastKey,
      })
    );

    cards.push(...(result.Items ?? []) as V2Card[]);
    lastKey = result.LastEvaluatedKey;

    if (limit && cards.length >= limit) break;
    if (!lastKey) break;
  }

  console.log(`Found ${cards.length} matching cards in ${V2_TABLE}`);

  const toMigrate = limit ? cards.slice(0, limit) : cards;

  console.log(`Processing ${toMigrate.length} cards\n`);

  for (const card of toMigrate) {
    await migrateCard(card, write);
  }

  console.log(`\nDone. ${toMigrate.length} cards ${write ? "migrated" : "previewed"}.`);
}

main().catch(console.error);
