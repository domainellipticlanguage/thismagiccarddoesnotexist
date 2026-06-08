/**
 * Migrate the cards table for paginated gallery + low-q thumbnails.
 *
 *   1. Create the `SequenceNumberIndex` GSI (dummyHashKey HASH, sequenceNumber
 *      RANGE, projection ALL) if it doesn't already exist.
 *   2. Backfill every row with dummyHashKey=0, sequenceNumber (createdDate epoch
 *      ms), and thumbnailUrls (re-rendered low-q webp for visible cards; a copy
 *      of renderedUrls for everything else / on render failure).
 *
 * Targets process.env.DYNAMODB_TABLE (the local/test table) by default — NOT
 * production. Pass --table=<name> to override.
 *
 * Usage:
 *   npx tsx scripts/add-sequence-index.ts                 # dry-run preview
 *   npx tsx scripts/add-sequence-index.ts --write         # create index + backfill
 *   npx tsx scripts/add-sequence-index.ts --write --skip-index
 *   npx tsx scripts/add-sequence-index.ts --write --limit=10 --concurrency=4
 */

import {
  DynamoDBClient,
  UpdateTableCommand,
  DescribeTableCommand,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { renderThumbnailOnly, uploadThumbnailFaces } from "../src/card-renderer.js";
import type { CardRecord } from "../src/types.js";
import dotenv from "dotenv";

dotenv.config();

const raw = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(raw, {
  marshallOptions: { removeUndefinedValues: true },
});

const INDEX_NAME = "SequenceNumberIndex";

const args = process.argv.slice(2);
const write = args.includes("--write");
const skipIndex = args.includes("--skip-index");
const tableArg = args.find((a) => a.startsWith("--table="));
const limitArg = args.find((a) => a.startsWith("--limit="));
const concArg = args.find((a) => a.startsWith("--concurrency="));
const TABLE = tableArg ? tableArg.split("=")[1] : process.env.DYNAMODB_TABLE || "thismagiccarddoesnotexist3";
const LIMIT = limitArg ? parseInt(limitArg.split("=")[1], 10) : undefined;
const CONCURRENCY = concArg ? parseInt(concArg.split("=")[1], 10) : 4;

const isVisible = (r: CardRecord): boolean =>
  !r.isDeleted && r.isFinished !== false && !r.isSuperseded;

async function ensureIndex(): Promise<void> {
  const described = await raw.send(new DescribeTableCommand({ TableName: TABLE }));
  const exists = (described.Table?.GlobalSecondaryIndexes ?? []).some((g) => g.IndexName === INDEX_NAME);
  if (exists) {
    console.log(`Index ${INDEX_NAME} already exists on ${TABLE}.`);
    return;
  }
  if (!write) {
    console.log(`(dry-run) would CREATE index ${INDEX_NAME} on ${TABLE}.`);
    return;
  }

  console.log(`Creating index ${INDEX_NAME} on ${TABLE}...`);
  await raw.send(
    new UpdateTableCommand({
      TableName: TABLE,
      AttributeDefinitions: [
        { AttributeName: "dummyHashKey", AttributeType: "N" },
        { AttributeName: "sequenceNumber", AttributeType: "N" },
      ],
      GlobalSecondaryIndexUpdates: [
        {
          Create: {
            IndexName: INDEX_NAME,
            KeySchema: [
              { AttributeName: "dummyHashKey", KeyType: "HASH" },
              { AttributeName: "sequenceNumber", KeyType: "RANGE" },
            ],
            Projection: { ProjectionType: "ALL" },
          },
        },
      ],
      // Table is PAY_PER_REQUEST, so the GSI inherits on-demand capacity.
    })
  );

  // Wait for the index to finish backfilling/activating.
  process.stdout.write("Waiting for index to become ACTIVE");
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000));
    const d = await raw.send(new DescribeTableCommand({ TableName: TABLE }));
    const gsi = (d.Table?.GlobalSecondaryIndexes ?? []).find((g) => g.IndexName === INDEX_NAME);
    process.stdout.write(".");
    if (gsi?.IndexStatus === "ACTIVE") break;
  }
  console.log("\nIndex ACTIVE.");
}

async function scanAll(): Promise<CardRecord[]> {
  const items: CardRecord[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const res = await doc.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey: startKey }));
    items.push(...((res.Items ?? []) as CardRecord[]));
    startKey = res.LastEvaluatedKey;
    if (LIMIT && items.length >= LIMIT) break;
  } while (startKey);
  return LIMIT ? items.slice(0, LIMIT) : items;
}

async function backfillOne(r: CardRecord): Promise<string> {
  const sequenceNumber = Number.isFinite(new Date(r.createdDate).getTime())
    ? new Date(r.createdDate).getTime()
    : 0;

  let thumbnailUrls: string[] = Array.isArray(r.thumbnailUrls) && r.thumbnailUrls.length
    ? r.thumbnailUrls
    : r.renderedUrls ?? [];

  // Re-render a real low-q thumbnail only for visible cards that don't have one.
  if (isVisible(r) && !(Array.isArray(r.thumbnailUrls) && r.thumbnailUrls.length)) {
    try {
      const rendered = await renderThumbnailOnly(r.cardData);
      thumbnailUrls = write ? await uploadThumbnailFaces(rendered) : r.renderedUrls ?? [];
    } catch (err) {
      thumbnailUrls = r.renderedUrls ?? [];
      return `~ ${r.id} ${r.cardData?.name ?? ""} (thumbnail render failed, fell back to full-res: ${(err as Error).message})`;
    }
  }

  if (write) {
    await doc.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { id: r.id },
        UpdateExpression: "SET dummyHashKey = :pk, sequenceNumber = :sn, thumbnailUrls = :tu",
        ExpressionAttributeValues: { ":pk": 0, ":sn": sequenceNumber, ":tu": thumbnailUrls },
      })
    );
  }
  return `✓ ${r.id} ${r.cardData?.name ?? ""} seq=${sequenceNumber} thumbs=${thumbnailUrls.length}`;
}

/** Run tasks with a fixed concurrency pool. */
async function pool<T>(items: T[], n: number, fn: (t: T, i: number) => Promise<string>): Promise<void> {
  let next = 0;
  let done = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      const msg = await fn(items[i], i);
      done++;
      console.log(`  [${done}/${items.length}] ${msg}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

async function main() {
  console.log(`Table: ${TABLE}`);
  console.log(`Mode: ${write ? "WRITE" : "DRY-RUN"} | concurrency=${CONCURRENCY}${LIMIT ? ` | limit=${LIMIT}` : ""}\n`);

  if (!skipIndex) await ensureIndex();

  const all = await scanAll();
  console.log(`\nBackfilling ${all.length} rows...`);
  await pool(all, CONCURRENCY, backfillOne);

  console.log(`\nDone. ${all.length} rows ${write ? "updated" : "previewed"}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
