import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  ScanCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import type { CardRecord, CardDocument, BugReport, BugReportItem } from "./types.js";
import { tableName } from "./aws-config.js";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

/** Write a card record. If supersededId is given, atomically mark that record superseded in the same transaction. */
export async function commitCard(record: CardRecord, supersededId?: string): Promise<void> {
  const start = Date.now();
  if (!supersededId) {
    await client.send(new PutCommand({ TableName: tableName(), Item: record }));
  } else {
    await client.send(
      new TransactWriteCommand({
        TransactItems: [
          { Put: { TableName: tableName(), Item: record } },
          {
            Update: {
              TableName: tableName(),
              Key: { id: supersededId },
              // REMOVE dummyHashKey drops the superseded card out of the
              // sparse SequenceNumberIndex so the gallery never reads it.
              UpdateExpression: "SET isSuperseded = :t REMOVE dummyHashKey",
              ExpressionAttributeValues: { ":t": true },
            },
          },
        ],
      })
    );
  }
  console.log(`[DDB] commit ${record.id}${supersededId ? " (supersedes " + supersededId + ")" : ""} in ${((Date.now() - start) / 1000).toFixed(2)}s`);
}

/** Get a card by id. */
export async function getCard(id: string): Promise<CardDocument | undefined> {
  const result = await client.send(
    new GetCommand({
      TableName: tableName(),
      Key: { id },
    })
  );
  if (!result.Item) return undefined;
  return result.Item as CardDocument;
}

/** Get all visible cards (scan, filter, sort by createdDate desc). */
export async function getLatestCards(limit = 300): Promise<CardDocument[]> {
  const result = await client.send(
    new ScanCommand({
      TableName: tableName(),
      FilterExpression:
        "(attribute_not_exists(isDeleted) OR isDeleted = :false) AND isFinished = :true AND (attribute_not_exists(isSuperseded) OR isSuperseded = :false)",
      ExpressionAttributeValues: {
        ":false": false,
        ":true": true,
      },
    })
  );

  const cards = (result.Items ?? []) as CardDocument[];
  cards.sort((a, b) => (b.createdDate || "").localeCompare(a.createdDate || ""));
  return cards.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Paginated gallery via the SequenceNumberIndex GSI.
//
// Every visible card shares one partition key (dummyHashKey = 0) and sorts on
// sequenceNumber (createdDate epoch ms), so a single Query returns the whole
// gallery newest-first and pages cleanly with LastEvaluatedKey.
// ---------------------------------------------------------------------------

const SEQUENCE_INDEX = "SequenceNumberIndex";
/** Constant GSI partition key — every *visible* gallery card lives here.
 *  The index is sparse: dummyHashKey is removed from a card when it is deleted
 *  or superseded, so the index contains exactly the visible set. */
export const GALLERY_PARTITION = 0;

export interface CardsPage {
  cards: CardDocument[];
  /** Opaque cursor for the next page; undefined when exhausted. */
  nextCursor?: string;
}

function encodeCursor(key: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(key), "utf-8").toString("base64url");
}

function decodeCursor(cursor: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8"));
}

/** One page of visible cards, newest first.
 *
 *  The index is sparse (only visible cards carry dummyHashKey) and sorted by
 *  sequenceNumber (creation date), so a single Query returns exactly the page
 *  with no post-read filtering or over-fetching. */
export async function getCardsPage(opts: { limit?: number; cursor?: string } = {}): Promise<CardsPage> {
  const limit = opts.limit ?? 60;
  const start = Date.now();

  const result = await client.send(
    new QueryCommand({
      TableName: tableName(),
      IndexName: SEQUENCE_INDEX,
      KeyConditionExpression: "dummyHashKey = :pk",
      ExpressionAttributeValues: { ":pk": GALLERY_PARTITION },
      ScanIndexForward: false,
      Limit: limit,
      ExclusiveStartKey: opts.cursor ? decodeCursor(opts.cursor) : undefined,
    })
  );

  const cards = (result.Items ?? []) as CardDocument[];
  console.log(`[DDB] gallery page: ${cards.length} cards (${((Date.now() - start) / 1000).toFixed(2)}s)`);
  return { cards, nextCursor: result.LastEvaluatedKey ? encodeCursor(result.LastEvaluatedKey) : undefined };
}

// Bug reports live as their own items so cards stay immutable. They share the
// card table but use a namespaced key, and carry none of the gallery attributes
// (dummyHashKey / isFinished), so they never surface in the GSI or scan filters.
const bugKey = (cardId: string) => `BUG#${cardId}`;

/** Read a card's current bug report, if any. */
export async function getBugReport(cardId: string): Promise<BugReport | undefined> {
  const result = await client.send(
    new GetCommand({ TableName: tableName(), Key: { id: bugKey(cardId) } })
  );
  if (!result.Item) return undefined;
  const { text, reportedAt } = result.Item as BugReportItem;
  return { text, reportedAt };
}

/** Set (overwrite) a card's bug report. */
export async function setBugReport(cardId: string, text: string): Promise<BugReport> {
  const reportedAt = new Date().toISOString();
  const item: BugReportItem = { id: bugKey(cardId), cardId, text, reportedAt };
  await client.send(new PutCommand({ TableName: tableName(), Item: item }));
  return { text, reportedAt };
}

export async function softDeleteCard(id: string): Promise<void> {
  await client.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { id },
      // REMOVE dummyHashKey drops the card out of the sparse
      // SequenceNumberIndex so it disappears from the gallery.
      UpdateExpression: "SET isDeleted = :t REMOVE dummyHashKey",
      ExpressionAttributeValues: { ":t": true },
    })
  );
}

