import { randomBytes, createHash } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
	DynamoDBDocumentClient,
	PutCommand,
	DeleteCommand,
	ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function getTableName(): string {
	const outputsPath = join(import.meta.dirname, "..", ".sst", "outputs.json");
	const outputs = JSON.parse(readFileSync(outputsPath, "utf-8"));
	const tableName = outputs.apiKeysTableName;
	if (!tableName) throw new Error("apiKeysTableName not found in .sst/outputs.json");
	return tableName;
}

const client = DynamoDBDocumentClient.from(new DynamoDBClient());

function hashKey(plaintext: string): string {
	return createHash("sha256").update(plaintext).digest("hex");
}

async function createKey(name: string) {
	const tableName = getTableName();
	const plaintext = randomBytes(32).toString("base64url");
	const keyHash = hashKey(plaintext);
	const keyId = randomBytes(8).toString("hex");

	await client.send(
		new PutCommand({
			TableName: tableName,
			Item: {
				keyHash,
				keyId,
				name,
				createdAt: new Date().toISOString(),
			},
		}),
	);

	console.log(`API key created:`);
	console.log(`  Name:   ${name}`);
	console.log(`  Key ID: ${keyId}`);
	console.log(`  Token:  ${plaintext}`);
	console.log(`\nStore this token securely — it cannot be retrieved again.`);
}

async function revokeKey(keyId: string) {
	const tableName = getTableName();

	const scan = await client.send(
		new ScanCommand({
			TableName: tableName,
			FilterExpression: "keyId = :kid",
			ExpressionAttributeValues: { ":kid": keyId },
		}),
	);

	const item = scan.Items?.[0];
	if (!item) {
		console.error(`Key ID "${keyId}" not found.`);
		process.exit(1);
	}

	await client.send(
		new DeleteCommand({
			TableName: tableName,
			Key: { keyHash: item.keyHash },
		}),
	);

	console.log(`Revoked key: ${item.name} (${keyId})`);
}

async function listKeys() {
	const tableName = getTableName();

	const result = await client.send(
		new ScanCommand({ TableName: tableName }),
	);

	const items = result.Items ?? [];
	if (items.length === 0) {
		console.log("No API keys found.");
		return;
	}

	console.log(`${"Name".padEnd(20)} ${"Key ID".padEnd(18)} Created`);
	console.log("-".repeat(58));
	for (const item of items) {
		console.log(
			`${(item.name as string).padEnd(20)} ${(item.keyId as string).padEnd(18)} ${item.createdAt}`,
		);
	}
}

const args = process.argv.slice(2);
const command = args[0];

switch (command) {
	case "--create": {
		const nameIdx = args.indexOf("--name");
		const name = nameIdx > -1 ? args[nameIdx + 1] : undefined;
		if (!name) {
			console.error("Usage: bun run provision.ts --create --name <name>");
			process.exit(1);
		}
		await createKey(name);
		break;
	}
	case "--revoke": {
		const keyId = args[1];
		if (!keyId) {
			console.error("Usage: bun run provision.ts --revoke <keyId>");
			process.exit(1);
		}
		await revokeKey(keyId);
		break;
	}
	case "--list":
		await listKeys();
		break;
	default:
		console.log("Usage:");
		console.log("  bun run provision.ts --create --name <name>");
		console.log("  bun run provision.ts --revoke <keyId>");
		console.log("  bun run provision.ts --list");
		process.exit(1);
}
