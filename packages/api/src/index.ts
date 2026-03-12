import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import { Resource } from "sst";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { apiKeyAuth } from "./middleware/auth";
import { queryEmails, getEmailByMessageId } from "./lib/dynamo";

const app = new Hono();

const s3 = new S3Client();

app.get("/health", (c) =>
	c.json({ status: "ok", timestamp: Date.now() }),
);

app.use("/emails/*", apiKeyAuth);
app.use("/emails", apiKeyAuth);

app.get("/emails", async (c) => {
	const inbox = c.req.query("inbox");
	if (!inbox) {
		return c.json(
			{ error: "MISSING_INBOX", message: "inbox query parameter is required" },
			400,
		);
	}

	if (!/^[a-z0-9._-]+$/i.test(inbox)) {
		return c.json(
			{ error: "INVALID_INBOX", message: "Inbox contains invalid characters" },
			400,
		);
	}

	const limitStr = c.req.query("limit");
	const limit = limitStr ? Number.parseInt(limitStr, 10) : 50;
	if (limit < 1 || limit > 100) {
		return c.json(
			{ error: "INVALID_LIMIT", message: "Limit must be between 1 and 100" },
			400,
		);
	}

	const wait = c.req.query("wait") === "true";
	const timeout = Math.min(
		Number.parseInt(c.req.query("timeout") ?? "28", 10),
		28,
	);
	const cursor = c.req.query("cursor");

	if (wait) {
		const deadline = Date.now() + timeout * 1000;
		while (Date.now() < deadline) {
			const result = await queryEmails({ inbox, cursor, limit });
			if (result.emails.length > 0) {
				return c.json(formatEmailsResponse(result));
			}
			await sleep(2000);
		}
		return c.json({ emails: [], nextCursor: undefined, hasMore: false });
	}

	const result = await queryEmails({ inbox, cursor, limit });
	return c.json(formatEmailsResponse(result));
});

app.get("/emails/:messageId/raw", async (c) => {
	const { messageId } = c.req.param();

	const email = await getEmailByMessageId(messageId);
	if (!email) {
		return c.json(
			{ error: "NOT_FOUND", message: "Email not found" },
			404,
		);
	}

	const url = await getSignedUrl(
		s3,
		new GetObjectCommand({
			Bucket: Resource.EmailBucket.name,
			Key: email.s3Key as string,
		}),
		{ expiresIn: 900 },
	);

	return c.redirect(url, 302);
});

function formatEmailsResponse(result: Awaited<ReturnType<typeof queryEmails>>) {
	return {
		emails: result.emails.map(({ s3Key, ...rest }) => ({
			...rest,
			rawUrl: `/emails/${rest.messageId}/raw`,
		})),
		nextCursor: result.nextCursor,
		hasMore: result.hasMore,
	};
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export const handler = handle(app);
