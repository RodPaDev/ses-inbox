import { describe, expect, mock, test } from "bun:test";

import type { AppDeps, EmailQueryResult } from "./index";
import { createApp, formatEmailsResponse } from "./index";

function mockDeps(overrides: Partial<AppDeps> = {}): AppDeps {
	return {
		queryEmails: mock(() =>
			Promise.resolve({ emails: [], nextCursor: undefined, hasMore: false }),
		),
		getEmailByMessageId: mock(() => Promise.resolve(null)),
		getSignedRawUrl: mock(() => Promise.resolve("https://s3.example.com/signed")),
		verifyKey: mock(() => Promise.resolve(true)),
		...overrides,
	};
}

function authedRequest(path: string, init?: RequestInit) {
	return new Request(`http://localhost${path}`, {
		...init,
		headers: { Authorization: "Bearer valid-token", ...init?.headers },
	});
}

describe("GET /health", () => {
	test("returns ok status", async () => {
		const app = createApp(mockDeps());
		const res = await app.request("/health");

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.status).toBe("ok");
		expect(body.timestamp).toBeNumber();
	});

	test("does not require auth", async () => {
		const deps = mockDeps();
		const app = createApp(deps);
		const res = await app.request("/health");

		expect(res.status).toBe(200);
		expect(deps.verifyKey).not.toHaveBeenCalled();
	});
});

describe("GET /emails", () => {
	test("returns 401 without auth header", async () => {
		const app = createApp(mockDeps());
		const res = await app.request("/emails?inbox=test");

		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.error).toBe("UNAUTHORIZED");
	});

	test("returns 401 with invalid token", async () => {
		const app = createApp(mockDeps({ verifyKey: () => Promise.resolve(false) }));
		const res = await app.request(authedRequest("/emails?inbox=test"));

		expect(res.status).toBe(401);
	});

	test("returns 400 when inbox is missing", async () => {
		const app = createApp(mockDeps());
		const res = await app.request(authedRequest("/emails"));

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toBe("MISSING_INBOX");
	});

	test("returns 400 for invalid inbox characters", async () => {
		const app = createApp(mockDeps());

		for (const inbox of ["test@bad", "test bad", "test/bad", "<script>"]) {
			const res = await app.request(authedRequest(`/emails?inbox=${encodeURIComponent(inbox)}`));
			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error).toBe("INVALID_INBOX");
		}
	});

	test("accepts valid inbox names", async () => {
		const app = createApp(mockDeps());

		for (const inbox of ["test", "user.name", "user-name", "user_name", "User123"]) {
			const res = await app.request(authedRequest(`/emails?inbox=${inbox}`));
			expect(res.status).toBe(200);
		}
	});

	test("returns 400 for limit out of range", async () => {
		const app = createApp(mockDeps());

		const res0 = await app.request(authedRequest("/emails?inbox=test&limit=0"));
		expect(res0.status).toBe(400);
		expect((await res0.json()).error).toBe("INVALID_LIMIT");

		const res101 = await app.request(authedRequest("/emails?inbox=test&limit=101"));
		expect(res101.status).toBe(400);
		expect((await res101.json()).error).toBe("INVALID_LIMIT");
	});

	test("uses default limit of 50", async () => {
		const queryEmails = mock(() =>
			Promise.resolve({ emails: [], nextCursor: undefined, hasMore: false }),
		);
		const app = createApp(mockDeps({ queryEmails }));
		await app.request(authedRequest("/emails?inbox=test"));

		expect(queryEmails).toHaveBeenCalledWith({ inbox: "test", cursor: undefined, limit: 50 });
	});

	test("passes cursor and limit to queryEmails", async () => {
		const queryEmails = mock(() =>
			Promise.resolve({ emails: [], nextCursor: undefined, hasMore: false }),
		);
		const app = createApp(mockDeps({ queryEmails }));
		await app.request(authedRequest("/emails?inbox=test&limit=10&cursor=abc"));

		expect(queryEmails).toHaveBeenCalledWith({ inbox: "test", cursor: "abc", limit: 10 });
	});

	test("returns formatted emails with rawUrl", async () => {
		const email = {
			messageId: "msg-1",
			inbox: "test",
			sender: "a@b.com",
			recipient: "test@domain.com",
			subject: "Hello",
			body: "<p>Hi</p>",
			receivedAt: 1000,
			s3Key: "incoming/abc",
		};
		const queryEmails = mock(() =>
			Promise.resolve({ emails: [email], nextCursor: undefined, hasMore: false }),
		);
		const app = createApp(mockDeps({ queryEmails }));
		const res = await app.request(authedRequest("/emails?inbox=test"));

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.emails).toHaveLength(1);
		expect(body.emails[0].rawUrl).toBe("/emails/msg-1/raw");
		expect(body.emails[0].s3Key).toBeUndefined();
		expect(body.emails[0].messageId).toBe("msg-1");
	});

	test("returns pagination info", async () => {
		const queryEmails = mock(() =>
			Promise.resolve({ emails: [], nextCursor: "cursor-123", hasMore: true }),
		);
		const app = createApp(mockDeps({ queryEmails }));
		const res = await app.request(authedRequest("/emails?inbox=test"));

		const body = await res.json();
		expect(body.nextCursor).toBe("cursor-123");
		expect(body.hasMore).toBe(true);
	});

	test("long-poll returns empty on timeout", async () => {
		const queryEmails = mock(() =>
			Promise.resolve({ emails: [], nextCursor: undefined, hasMore: false }),
		);
		const app = createApp(mockDeps({ queryEmails }));
		const res = await app.request(authedRequest("/emails?inbox=test&wait=true&timeout=1"));

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.emails).toEqual([]);
		expect(body.hasMore).toBe(false);
	});

	test("long-poll returns immediately when emails found", async () => {
		const email = {
			messageId: "msg-1",
			inbox: "test",
			sender: "a@b.com",
			recipient: "test@domain.com",
			subject: "Hello",
			body: "",
			receivedAt: 1000,
			s3Key: "incoming/abc",
		};
		const queryEmails = mock(() =>
			Promise.resolve({ emails: [email], nextCursor: undefined, hasMore: false }),
		);
		const app = createApp(mockDeps({ queryEmails }));

		const start = Date.now();
		const res = await app.request(authedRequest("/emails?inbox=test&wait=true&timeout=10"));
		const elapsed = Date.now() - start;

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.emails).toHaveLength(1);
		expect(elapsed).toBeLessThan(3000);
	});

	test("long-poll timeout is capped at 28 seconds", async () => {
		const queryEmails = mock(() =>
			Promise.resolve({ emails: [], nextCursor: undefined, hasMore: false }),
		);
		const app = createApp(mockDeps({ queryEmails }));
		const res = await app.request(authedRequest("/emails?inbox=test&wait=true&timeout=1"));

		expect(res.status).toBe(200);
		expect(queryEmails).toHaveBeenCalled();
	});
});

describe("GET /emails/:messageId/raw", () => {
	test("returns 401 without auth", async () => {
		const app = createApp(mockDeps());
		const res = await app.request("/emails/msg-1/raw");

		expect(res.status).toBe(401);
	});

	test("returns 404 when email not found", async () => {
		const app = createApp(mockDeps());
		const res = await app.request(authedRequest("/emails/msg-1/raw"));

		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error).toBe("NOT_FOUND");
	});

	test("redirects to signed URL when email found", async () => {
		const getEmailByMessageId = mock(() =>
			Promise.resolve({ s3Key: "incoming/abc", messageId: "msg-1" }),
		);
		const getSignedRawUrl = mock(() =>
			Promise.resolve("https://s3.example.com/signed-url"),
		);
		const app = createApp(mockDeps({ getEmailByMessageId, getSignedRawUrl }));
		const res = await app.request(authedRequest("/emails/msg-1/raw"), { redirect: "manual" });

		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe("https://s3.example.com/signed-url");
		expect(getSignedRawUrl).toHaveBeenCalledWith("incoming/abc");
	});
});

describe("formatEmailsResponse", () => {
	test("strips s3Key and adds rawUrl", () => {
		const result: EmailQueryResult = {
			emails: [
				{
					messageId: "msg-1",
					inbox: "test",
					sender: "a@b.com",
					recipient: "test@d.com",
					subject: "Hi",
					body: "<p>Hi</p>",
					receivedAt: 1000,
					s3Key: "incoming/abc",
				},
			],
			nextCursor: undefined,
			hasMore: false,
		};

		const formatted = formatEmailsResponse(result);

		expect(formatted.emails[0].rawUrl).toBe("/emails/msg-1/raw");
		expect((formatted.emails[0] as Record<string, unknown>).s3Key).toBeUndefined();
	});

	test("preserves pagination fields", () => {
		const result: EmailQueryResult = {
			emails: [],
			nextCursor: "cursor-abc",
			hasMore: true,
		};

		const formatted = formatEmailsResponse(result);

		expect(formatted.nextCursor).toBe("cursor-abc");
		expect(formatted.hasMore).toBe(true);
	});
});
