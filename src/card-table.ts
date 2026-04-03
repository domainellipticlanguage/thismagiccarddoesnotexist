import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import type { CardRecord, CardDocument } from "./types.js";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

function tableName(): string {
  return process.env.DYNAMODB_TABLE || "thismagiccarddoesnotexist3";
}

/** Write a single card record. */
export async function putCard(record: CardRecord): Promise<void> {
  await client.send(new PutCommand({ TableName: tableName(), Item: record }));
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

export async function softDeleteCard(id: string): Promise<void> {
  await client.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { id },
      UpdateExpression: "SET isDeleted = :t",
      ExpressionAttributeValues: { ":t": true },
    })
  );
}

export async function markSuperseded(id: string): Promise<void> {
  await client.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { id },
      UpdateExpression: "SET isSuperseded = :t",
      ExpressionAttributeValues: { ":t": true },
    })
  );
}
