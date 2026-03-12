import type { S3Event } from "aws-lambda";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { simpleParser } from "mailparser";
import { extractInbox } from "./lib/email-parser";
import { putEmail } from "./lib/dynamo";

const s3 = new S3Client();

export async function handler(event: S3Event) {
	for (const record of event.Records) {
		const bucket = record.s3.bucket.name;
		const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));

		const obj = await s3.send(
			new GetObjectCommand({ Bucket: bucket, Key: key }),
		);

		const raw = (await obj.Body?.transformToString()) ?? "";
		const parsed = await simpleParser(raw);

		const domain = process.env.SES_DOMAIN;
		if (!domain) throw new Error("SES_DOMAIN not set");

		const to = parsed.to?.text ?? "";
		const inbox = extractInbox(to, domain);
		if (!inbox) {
			console.warn(`No matching inbox for recipient: ${to}`);
			continue;
		}

		await putEmail({
			inbox,
			messageId: parsed.messageId || key,
			sender: parsed.from?.text ?? "",
			recipient: to,
			subject: parsed.subject ?? "",
			body: parsed.html || "",
			s3Key: key,
			receivedAt: Date.now(),
		});
	}
}
