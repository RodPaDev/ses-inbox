import { describe, expect, mock, test } from "bun:test";
import type { S3Event, S3EventRecord } from "aws-lambda";

import type { EmailItem, IngestDeps } from "./ingest";
import { createIngestHandler } from "./ingest";

function makeS3Event(...records: { bucket: string; key: string }[]): S3Event {
	return {
		Records: records.map(
			(r) =>
				({
					s3: {
						bucket: { name: r.bucket },
						object: { key: r.key },
					},
				}) as unknown as S3EventRecord,
		),
	};
}

function makeRawEmail(
	opts: {
		from?: string;
		to?: string;
		subject?: string;
		messageId?: string;
		body?: string;
	} = {},
) {
	return [
		`From: ${opts.from ?? "sender@example.com"}`,
		`To: ${opts.to ?? "test@receive.example.com"}`,
		`Subject: ${opts.subject ?? "Test Subject"}`,
		`Message-ID: ${opts.messageId ?? "<msg-001@example.com>"}`,
		"MIME-Version: 1.0",
		"Content-Type: text/html; charset=utf-8",
		"",
		opts.body ?? "<p>Hello</p>",
	].join("\r\n");
}

function mockDeps(overrides: Partial<IngestDeps> = {}): IngestDeps {
	return {
		getObject: mock(() => Promise.resolve(makeRawEmail())),
		putEmail: mock((_item: EmailItem) => Promise.resolve()),
		domain: "receive.example.com",
		...overrides,
	};
}

describe("createIngestHandler", () => {
	test("parses email and writes to DynamoDB", async () => {
		const putEmail = mock((_item: EmailItem) => Promise.resolve());
		const deps = mockDeps({ putEmail });
		const handler = createIngestHandler(deps);

		await handler(makeS3Event({ bucket: "my-bucket", key: "incoming/abc" }));

		expect(putEmail).toHaveBeenCalledTimes(1);
		const item = putEmail.mock.calls[0][0];
		expect(item.inbox).toBe("test");
		expect(item.sender).toBe("sender@example.com");
		expect(item.recipient).toBe("test@receive.example.com");
		expect(item.subject).toBe("Test Subject");
		expect(item.s3Key).toBe("incoming/abc");
		expect(item.receivedAt).toBeNumber();
	});

	test("decodes URL-encoded S3 keys", async () => {
		const getObject = mock(() => Promise.resolve(makeRawEmail()));
		const deps = mockDeps({ getObject });
		const handler = createIngestHandler(deps);

		await handler(
			makeS3Event({ bucket: "b", key: "incoming/hello+world%20test" }),
		);

		expect(getObject).toHaveBeenCalledWith("b", "incoming/hello world test");
	});

	test("skips emails with non-matching domain", async () => {
		const raw = makeRawEmail({ to: "user@other-domain.com" });
		const putEmail = mock((_item: EmailItem) => Promise.resolve());
		const deps = mockDeps({
			getObject: () => Promise.resolve(raw),
			putEmail,
		});
		const handler = createIngestHandler(deps);

		await handler(makeS3Event({ bucket: "b", key: "incoming/abc" }));

		expect(putEmail).not.toHaveBeenCalled();
	});

	test("uses S3 key as messageId fallback when header is missing", async () => {
		const raw = [
			"From: sender@example.com",
			"To: test@receive.example.com",
			"Subject: No ID",
			"MIME-Version: 1.0",
			"Content-Type: text/html; charset=utf-8",
			"",
			"<p>Hello</p>",
		].join("\r\n");

		const putEmail = mock((_item: EmailItem) => Promise.resolve());
		const deps = mockDeps({
			getObject: () => Promise.resolve(raw),
			putEmail,
		});
		const handler = createIngestHandler(deps);

		await handler(makeS3Event({ bucket: "b", key: "incoming/fallback-key" }));

		const item = putEmail.mock.calls[0][0];
		expect(item.messageId).toBe("incoming/fallback-key");
	});

	test("processes multiple records in a single event", async () => {
		const putEmail = mock((_item: EmailItem) => Promise.resolve());
		const deps = mockDeps({ putEmail });
		const handler = createIngestHandler(deps);

		await handler(
			makeS3Event(
				{ bucket: "b", key: "incoming/a" },
				{ bucket: "b", key: "incoming/b" },
				{ bucket: "b", key: "incoming/c" },
			),
		);

		expect(putEmail).toHaveBeenCalledTimes(3);
	});

	test("extracts inbox as lowercase", async () => {
		const raw = makeRawEmail({ to: "TestInbox@receive.example.com" });
		const putEmail = mock((_item: EmailItem) => Promise.resolve());
		const deps = mockDeps({
			getObject: () => Promise.resolve(raw),
			putEmail,
		});
		const handler = createIngestHandler(deps);

		await handler(makeS3Event({ bucket: "b", key: "incoming/abc" }));

		const item = putEmail.mock.calls[0][0];
		expect(item.inbox).toBe("testinbox");
	});
});
