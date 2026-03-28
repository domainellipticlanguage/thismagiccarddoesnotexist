import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  UpdateCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import type { CardData } from "@domainellipticlanguage/mtg-crucible";
import type { CardRow, CardDocument } from "./types.js";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

function tableName(): string {
  return process.env.DYNAMODB_TABLE || "thismagiccarddoesnotexist3";
}

/** Write all rows for a card (one per face). */
export async function putCardRows(rows: CardRow[]): Promise<void> {
  await Promise.all(
    rows.map((row) =>
      client.send(new PutCommand({ TableName: tableName(), Item: row }))
    )
  );
}

/** Flatten a CardData tree into rows. */
export function flattenCardData(
  id: string,
  cardData: CardData,
  renderedUrls: string[],
  meta: Omit<CardRow, "id" | "subCardIndex" | "cardData" | "renderedUrl">
): CardRow[] {
  const rows: CardRow[] = [];
  let index = 0;
  let current: CardData | undefined = cardData;

  while (current) {
    // Strip linkedCard from the stored cardData — it's the next row
    const { linkedCard, ...rest }: CardData = current;
    const row: CardRow = {
      id,
      subCardIndex: index,
      cardData: rest as CardData,
      renderedUrl: renderedUrls[index] || "",
    };

    if (index === 0) {
      Object.assign(row, meta);
    }

    rows.push(row);
    current = linkedCard;
    index++;
  }

  return rows;
}

/** Assemble rows back into a CardDocument with linkedCard chain. */
function assembleCard(rows: CardRow[]): CardDocument {
  const sorted = rows.sort((a, b) => a.subCardIndex - b.subCardIndex);
  const main = sorted[0];

  // Rebuild linkedCard chain
  let cardData = { ...main.cardData };
  if (sorted.length > 1) {
    let current = cardData;
    for (let i = 1; i < sorted.length; i++) {
      current.linkedCard = { ...sorted[i].cardData };
      current = current.linkedCard;
    }
  }

  return {
    id: main.id,
    cardData,
    crucibleText: main.crucibleText || "",
    scryfallText: main.scryfallText || "",
    scryfallJson: main.scryfallJson || "",
    rotations: main.rotations || [],
    prompt: main.prompt || "",
    explanation: main.explanation || "",
    suggestionArtwork: main.suggestionArtwork || "",
    suggestionMechanics: main.suggestionMechanics || "",
    artEditMode: main.artEditMode,
    creatorId: main.creatorId || "",
    parentId: main.parentId,
    createdDate: main.createdDate || "",
    isDeleted: main.isDeleted || false,
    isFinished: main.isFinished || false,
    isSuperseded: main.isSuperseded || false,
    renderedUrls: sorted.map((r) => r.renderedUrl),
  };
}

/** Get a card by id (all faces). */
export async function getCard(id: string): Promise<CardDocument | undefined> {
  const result = await client.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: "id = :id",
      ExpressionAttributeValues: { ":id": id },
    })
  );
  const rows = (result.Items ?? []) as CardRow[];
  if (rows.length === 0) return undefined;
  return assembleCard(rows);
}

/** Get all visible cards (scan, filter, sort by createdDate desc). */
export async function getLatestCards(limit = 300): Promise<CardDocument[]> {
  const result = await client.send(
    new ScanCommand({
      TableName: tableName(),
      FilterExpression:
        "subCardIndex = :zero AND (attribute_not_exists(isDeleted) OR isDeleted = :false) AND isFinished = :true AND (attribute_not_exists(isSuperseded) OR isSuperseded = :false)",
      ExpressionAttributeValues: {
        ":zero": 0,
        ":false": false,
        ":true": true,
      },
    })
  );

  const mainRows = (result.Items ?? []) as CardRow[];

  // For each main row, query its sub-cards
  const cards = await Promise.all(
    mainRows.map(async (main) => {
      const subResult = await client.send(
        new QueryCommand({
          TableName: tableName(),
          KeyConditionExpression: "id = :id",
          ExpressionAttributeValues: { ":id": main.id },
        })
      );
      return assembleCard((subResult.Items ?? []) as CardRow[]);
    })
  );

  // Sort by createdDate descending
  cards.sort((a, b) => (b.createdDate || "").localeCompare(a.createdDate || ""));

  return cards.slice(0, limit);
}

export async function softDeleteCard(id: string): Promise<void> {
  await client.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { id, subCardIndex: 0 },
      UpdateExpression: "SET isDeleted = :t",
      ExpressionAttributeValues: { ":t": true },
    })
  );
}

export async function markSuperseded(id: string): Promise<void> {
  await client.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { id, subCardIndex: 0 },
      UpdateExpression: "SET isSuperseded = :t",
      ExpressionAttributeValues: { ":t": true },
    })
  );
}
