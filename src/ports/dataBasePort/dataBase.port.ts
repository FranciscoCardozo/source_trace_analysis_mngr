import config from "../../config";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
    DynamoDBDocumentClient,
    PutCommand,
    QueryCommand,
    ScanCommand,
    UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import { DynamoRequestKeys } from "../../domain/models/dynamo/dynamoRequestKeys.interface";

const client = new DynamoDBClient({
  region: "us-east-1",
});

const dynamoDb = DynamoDBDocumentClient.from(client);
const tableName = config.DYNAMODB_TABLE_NAME;

export default class DataBasePort {
    constructor() {
    }

    public static async getItems(
      keys: DynamoRequestKeys
    ) {
      try {
        // Si no hay PK, trae todo
        if (!keys.PK) {
          return await dynamoDb.send(
            new ScanCommand({
              TableName: tableName,
            })
          );
        }

        const queryParams: any = {
          TableName: tableName,
          KeyConditionExpression: "PK = :pk",
          ExpressionAttributeValues: {
            ":pk": keys.PK,
          },
        };

        // Si viene SK, agrega el filtro
        if (keys.SK) {
          queryParams.KeyConditionExpression += " AND SK = :sk";
          queryParams.ExpressionAttributeValues[":sk"] = keys.SK;
        }

        return await dynamoDb.send(new QueryCommand(queryParams));
      } catch (error) {
        throw error;
      }
    }

    public static async setItem (
      keys: DynamoRequestKeys,
      body: any
    ) {
        return dynamoDb.send(
          new PutCommand({
            TableName: tableName,
            Item: {
              PK: keys.PK,
              SK: keys.SK,
              ...body
            }
          })
        );
    }

    public static async updateItem(
      keys: DynamoRequestKeys,
      updateExpression: string,
      expressionAttributeNames: Record<string, string>,
      expressionAttributeValues: Record<string, any>
    ) {
        return dynamoDb.send(
          new UpdateCommand({
            TableName: tableName,
            Key: {
              PK: keys.PK,
              SK: keys.SK
            },
            UpdateExpression: updateExpression,
            ExpressionAttributeNames: expressionAttributeNames,
            ExpressionAttributeValues: expressionAttributeValues,
            ReturnValues: "UPDATED_NEW"
          })
        );
    }
}