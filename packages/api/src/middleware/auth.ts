import { createMiddleware } from "hono/factory";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { Resource } from "sst";
import { createHash } from "node:crypto";

const client = DynamoDBDocumentClient.from(new DynamoDBClient());

function hashKey(plaintext: string): string {
	return createHash("sha256").update(plaintext).digest("hex");
}

export const apiKeyAuth = createMiddleware(async (c, next) => {
	const header = c.req.header("Authorization");
	if (!header?.startsWith("Bearer ")) {
		return c.json(
			{ error: "UNAUTHORIZED", message: "Missing or invalid bearer token" },
			401,
		);
	}

	const token = header.slice(7);
	const keyHash = hashKey(token);

	const result = await client.send(
		new GetCommand({
			TableName: Resource.ApiKeysTable.name,
			Key: { keyHash },
		}),
	);

	if (!result.Item) {
		return c.json(
			{ error: "UNAUTHORIZED", message: "Invalid API key" },
			401,
		);
	}

	await next();
});
