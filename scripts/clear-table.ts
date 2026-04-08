/**
 * Clear all items from a DynamoDB table.
 *
 * Usage:
 *   npx tsx scripts/clear-table.ts                # dry-run, lists what would be deleted
 *   npx tsx scripts/clear-table.ts --write        # actually delete
 *   npx tsx scripts/clear-table.ts --table foo    # override table name
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import dotenv from "dotenv";

dotenv.config();

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const tableArg = args.find((a) => a.startsWith("--table="));
  const table = tableArg ? tableArg.split("=")[1] : process.env.DYNAMODB_TABLE || "thismagiccarddoesnotexist3";

  console.log(`Clearing table: ${table}`);
  console.log(`Mode: ${write ? "WRITE (will delete)" : "DRY-RUN"}\n`);

  // Scan all ids
  const ids: string[] = [];
  let lastKey: Record<string, any> | undefined;
  do {
    const result = await client.send(
      new ScanCommand({
        TableName: table,
        ProjectionExpression: "id",
        ExclusiveStartKey: lastKey,
      })
    );
    for (const item of result.Items ?? []) {
      if (item.id) ids.push(item.id);
    }
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  console.log(`Found ${ids.length} items`);

  if (!write) {
    console.log("(dry-run, not deleting)");
    return;
  }

  // BatchWrite delete in chunks of 25
  for (let i = 0; i < ids.length; i += 25) {
    const chunk = ids.slice(i, i + 25);
    await client.send(
      new BatchWriteCommand({
        RequestItems: {
          [table]: chunk.map((id) => ({ DeleteRequest: { Key: { id } } })),
        },
      })
    );
    console.log(`  deleted ${Math.min(i + 25, ids.length)} / ${ids.length}`);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
