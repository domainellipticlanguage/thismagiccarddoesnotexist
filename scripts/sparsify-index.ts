/**
 * Make the SequenceNumberIndex GSI sparse: remove dummyHashKey from every
 * NON-visible card (deleted, superseded, or unfinished) so the index contains
 * exactly the gallery's visible set. Visible cards keep dummyHashKey = 0.
 *
 * Safe to run against a table whose code still uses the old FilterExpression —
 * it only ever removes the key from rows the filter already excluded, so the
 * live gallery is unaffected either way.
 *
 * Targets process.env.DYNAMODB_TABLE by default. Pass --table=<name> for prod.
 *
 * Usage:
 *   npx tsx scripts/sparsify-index.ts                 # dry-run preview
 *   npx tsx scripts/sparsify-index.ts --write
 *   npx tsx scripts/sparsify-index.ts --write --table=<prod-table>
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { CardRecord } from "../src/types.js";
import dotenv from "dotenv";

dotenv.config();

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const args = process.argv.slice(2);
const write = args.includes("--write");
const tableArg = args.find((a) => a.startsWith("--table="));
const TABLE = tableArg ? tableArg.split("=")[1] : process.env.DYNAMODB_TABLE || "thismagiccarddoesnotexist3";

const isVisible = (r: CardRecord): boolean =>
  !r.isDeleted && r.isFinished !== false && !r.isSuperseded;

async function main() {
  console.log(`Table: ${TABLE}`);
  console.log(`Mode: ${write ? "WRITE" : "DRY-RUN"}\n`);

  let startKey: Record<string, unknown> | undefined;
  let scanned = 0;
  let toStrip = 0;
  let stripped = 0;

  do {
    const res = await doc.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey: startKey }));
    for (const r of (res.Items ?? []) as CardRecord[]) {
      scanned++;
      // Only act on non-visible rows that are still in the index.
      if (isVisible(r) || r.dummyHashKey === undefined) continue;
      toStrip++;
      console.log(`  strip ${r.id} ${r.cardData?.name ?? ""} (deleted=${!!r.isDeleted} superseded=${!!r.isSuperseded} finished=${r.isFinished !== false})`);
      if (write) {
        await doc.send(
          new UpdateCommand({
            TableName: TABLE,
            Key: { id: r.id },
            UpdateExpression: "REMOVE dummyHashKey",
          })
        );
        stripped++;
      }
    }
    startKey = res.LastEvaluatedKey;
  } while (startKey);

  console.log(`\nScanned ${scanned} rows. ${write ? `Stripped ${stripped}` : `Would strip ${toStrip}`} non-visible row(s) from the index.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
