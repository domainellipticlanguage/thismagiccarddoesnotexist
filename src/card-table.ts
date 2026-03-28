import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { CardRecord } from "./types.js";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

function tableName(): string {
  return process.env.DYNAMODB_TABLE || "thismagiccarddoesnotexist3";
}

export async function getCard(id: string): Promise<CardRecord | undefined> {
  const result = await client.send(
    new GetCommand({ TableName: tableName(), Key: { id } })
  );
  return result.Item as CardRecord | undefined;
}

export async function putCard(card: CardRecord): Promise<void> {
  await client.send(new PutCommand({ TableName: tableName(), Item: card }));
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

const SENTINEL_ID = "00000000-0000-0000-0000-000000000000";

export async function nextSequenceNumber(): Promise<number> {
  const result = await client.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { id: SENTINEL_ID },
      UpdateExpression:
        "SET sequenceNumber = if_not_exists(sequenceNumber, :zero) + :inc, dummyHashKey = :dhk",
      ExpressionAttributeValues: { ":zero": 0, ":inc": 1, ":dhk": 0 },
      ReturnValues: "UPDATED_NEW",
    })
  );
  return result.Attributes!.sequenceNumber as number;
}

export async function getLatestCards(limit = 300): Promise<CardRecord[]> {
  const result = await client.send(
    new QueryCommand({
      TableName: tableName(),
      IndexName: "SequenceNumberIndex",
      KeyConditionExpression: "dummyHashKey = :dhk",
      ExpressionAttributeValues: { ":dhk": 0 },
      ScanIndexForward: false,
      Limit: limit,
    })
  );
  return (result.Items ?? []).filter(
    (item: any) =>
      !item.isDeleted &&
      item.isFinished &&
      !item.isSuperseded &&
      item.id !== SENTINEL_ID
  ) as CardRecord[];
}
