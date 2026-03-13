import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { S3Event } from "aws-lambda";
import type { AddressObject } from "mailparser";
import { simpleParser } from "mailparser";

import type { EmailItem } from "./lib/dynamo";
import { putEmail } from "./lib/dynamo";
import { extractInbox } from "./lib/email-parser";

export type { EmailItem };

export interface IngestDeps {
	getObject: (bucket: string, key: string) => Promise<string>;
	putEmail: (item: EmailItem) => Promise<void>;
	domain: string;
}

function getAddressText(
	addr: AddressObject | AddressObject[] | undefined,
): string {
	if (!addr) return "";
	if (Array.isArray(addr)) return addr[0]?.text ?? "";
	return addr.text ?? "";
}

export function createIngestHandler(deps: IngestDeps) {
	return async (event: S3Event) => {
		for (const record of event.Records) {
			const bucket = record.s3.bucket.name;
			const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));

			const raw = await deps.getObject(bucket, key);
			const parsed = await simpleParser(raw);

			const to = getAddressText(parsed.to);
			const inbox = extractInbox(to, deps.domain);
			if (!inbox) {
				console.warn(`No matching inbox for recipient: ${to}`);
				continue;
			}

			await deps.putEmail({
				inbox,
				messageId: parsed.messageId || key,
				sender: getAddressText(parsed.from),
				recipient: to,
				subject: parsed.subject ?? "",
				body: parsed.html || "",
				s3Key: key,
				receivedAt: Date.now(),
			});
		}
	};
}

const s3 = new S3Client();

export const handler = createIngestHandler({
	getObject: async (bucket, key) => {
		const obj = await s3.send(
			new GetObjectCommand({ Bucket: bucket, Key: key }),
		);
		return (await obj.Body?.transformToString()) ?? "";
	},
	putEmail,
	domain:
		process.env.SES_DOMAIN ??
		(() => {
			throw new Error("SES_DOMAIN not set");
		})(),
});
