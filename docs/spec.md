# ses-inbox

Serverless inbound email API for AWS. One deploy, queryable inbox, zero idle cost.

## What It Is

SES receives email. S3 stores it. DynamoDB indexes it. A Hono API lets you query it. ses-inbox wires all of that together in a single `sst deploy`.

AWS gives you the building blocks for inbound email but no API to query what arrived. Every team builds this glue themselves. ses-inbox is that glue, packaged as infrastructure.

## Primary Use Case: E2E Testing

Your test sends an email to `signup-test-42@receive.yourdomain.com`. Your test calls the API with `signup-test-42`. The email is there. No SMTP server, no SaaS pricing, no cleanup.

But the core is generic. Same infrastructure works for support ticket ingestion, inbound lead capture, email archiving, transactional monitoring, or anything that starts with "receive an email and do something with it."

## User Flow

1. **Clone** — `git clone` and `cp .env.example .env`, set your domain + hosted zone ID.
2. **Deploy** — `sst deploy`. Done.
3. **Generate a key** — `bun run provision --create --name my-key`. Get a Bearer token.
4. **Query** — Send email to `<anything>@receive.yourdomain.com`. Call `GET /emails?inbox=<anything>`. It's there.
5. **Expire** — Emails auto-expire after 7 days. S3 objects at 8 days.

## What Runs

- **Ingest Lambda** — S3 event triggers on new email. Parses headers, writes metadata to DynamoDB.
- **API Lambda** — Hono app with Function URL. Handles queries, long-poll, pre-signed URL redirects.

## What's Stored

- **S3** — Raw `.eml` files under `incoming/`. No server-side parsing. Clients access full content via pre-signed URL.
- **EmailsTable (DynamoDB)** — PK: inbox, SK: timestamp#messageId. Stores sender, recipient, subject, S3 key. TTL-enabled.
- **ApiKeysTable (DynamoDB)** — PK: keyHash (SHA-256). Stores key metadata for auth.

Two tables. One bucket. That's the data layer.

## How Emails Get In

MX record on your subdomain → SES inbound (catch-all) → S3 bucket → S3 event → Ingest Lambda extracts inbox from recipient address, writes metadata to DynamoDB.

No MIME parsing. The Lambda is trivial by design.

## How Emails Get Out

- **Poll** — `GET /emails?inbox=signup-test-42`. Cursor-based pagination.
- **Long-poll** — `GET /emails?inbox=signup-test-42&wait=true`. Holds up to 28s, re-queries every 2s, returns immediately on match.

Same endpoint, two modes. No WebSocket, no streaming, no persistent connections.

## Auth

- **Key generation** — `bun run provision --create --name <name>`. Generates a random key, stores SHA-256 hash in DynamoDB, prints plaintext once.
- **API access** — `Authorization: Bearer <key>`. API hashes the key, does a DynamoDB GetItem. No HMAC, no SSM secrets.
- **Revocation** — `bun run provision --revoke <keyId>`. Deletes the hash from DynamoDB.

## What SST Handles

- SES domain verification for your subdomain
- MX record on Route 53
- Catch-all receipt rule → S3
- S3 bucket with 8-day lifecycle
- DynamoDB tables with TTL
- Lambda functions with IAM roles
- Function URL for the API

Two config values: `SES_DOMAIN` and `HOSTED_ZONE_ID`. Everything else is wired automatically.

## Defaults

- Email TTL: 7 days (DynamoDB), 8 days (S3)
- Long-poll timeout: 28 seconds
- Long-poll interval: 2 seconds

## Cost

$0 at zero traffic. ~$3-5/month at 10k emails and 50k API calls. No containers, no EC2, no NAT gateways. Domain not included — use a subdomain of something you already own.

## Future

- UI dashboard
- Real-time push (WebSocket or SSE)
- Webhooks (POST to callback URL on new email)
- Multi-domain support
- Optional server-side email parsing
- SDK client library
