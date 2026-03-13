import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

function loadApiUrl(): string {
	const fromEnv = process.env.API_URL;
	if (fromEnv) return fromEnv;

	try {
		const outputs = JSON.parse(readFileSync(".sst/outputs.json", "utf-8"));
		if (outputs.apiUrl) return outputs.apiUrl;
	} catch {}

	console.error("Could not resolve API_URL from env or .sst/outputs.json");
	process.exit(1);
}

const API_URL = loadApiUrl().replace(/\/+$/, "");
const API_TOKEN = process.env.API_TOKEN;

if (!API_TOKEN) {
	console.error("API_TOKEN is required in .env");
	process.exit(1);
}

const { values } = parseArgs({
	args: process.argv.slice(2),
	options: {
		inbox: { type: "string", short: "i" },
		limit: { type: "string", short: "l" },
	},
});

const inbox = values.inbox ?? "anything";
const limit = values.limit ?? "10";

const url = new URL("/v1/emails", API_URL);
url.searchParams.set("inbox", inbox);
url.searchParams.set("limit", limit);

console.log(`GET ${url}\n`);

const response = await fetch(url, {
	headers: { Authorization: `Bearer ${API_TOKEN}` },
});

if (!response.ok) {
	console.error(`${response.status} ${response.statusText}`);
	const body = await response.text();
	if (body) console.error(body);
	process.exit(1);
}

const data = await response.json();

console.log(`Found ${data.emails.length} email(s):`);
for (const email of data.emails) {
	console.log(`  [${new Date(email.receivedAt).toISOString()}] ${email.sender} → ${email.inbox}`);
	console.log(`    Subject: ${email.subject}`);
	console.log(`    Raw: ${API_URL}${email.rawUrl}`);
	if (email.attachments.length > 0) {
		for (const att of email.attachments) {
			console.log(`    Attachment: ${att.filename} (${att.contentType}, ${att.size}B) → ${API_URL}${att.url}`);
		}
	}
}

if (data.hasMore) {
	console.log(`\nMore emails available (nextCursor: ${data.nextCursor})`);
}
