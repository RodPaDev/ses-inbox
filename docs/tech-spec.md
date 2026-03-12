# ses-inbox — Technical Specification

> Serverless inbound email API for AWS. One deploy, queryable inbox, zero idle cost.

**SST Version:** v4.x (Pulumi/Terraform engine)
**Runtime:** Node.js 22.x (AWS Lambda)
**Language:** TypeScript

---

## 1. System Architecture

See [diagrams/architecture.md](diagrams/architecture.md)

## 2. Email Ingestion Flow

See [diagrams/flows.md](diagrams/flows.md#email-ingestion-flow)

## 3. Query & Long-Poll Flow

See [diagrams/flows.md](diagrams/flows.md#query--long-poll-flow)

## 4. Auth Flow

See [diagrams/flows.md](diagrams/flows.md#auth-flow)

## 5. Data Model

See [diagrams/data-model.md](diagrams/data-model.md)

## 6. API Contract

See [api-contract.md](api-contract.md)

## 7. HMAC Token Design

See [diagrams/flows.md](diagrams/flows.md#hmac-token-structure)

## 8. Infrastructure (SST v4)

See [diagrams/infrastructure.md](diagrams/infrastructure.md)

## 9. SDK Public API

See [diagrams/sdk.md](diagrams/sdk.md)

---

## 10. Project Structure

```
ses-inbox/
├── sst.config.ts
├── sst-env.d.ts
├── package.json
├── tsconfig.json
├── packages/
│   ├── functions/
│   │   ├── src/
│   │   │   ├── ingest.ts          # S3 event → DynamoDB metadata
│   │   │   ├── api.ts             # GET /emails, /raw, /health
│   │   │   └── lib/
│   │   │       ├── hmac.ts        # Token sign/verify
│   │   │       ├── email-parser.ts # Minimal header extraction
│   │   │       └── dynamo.ts      # Query helpers
│   │   └── package.json
│   └── sdk/
│       ├── src/
│       │   ├── index.ts           # SesInboxClient + SesInboxSession
│       │   ├── wait.ts            # Long-poll helpers
│       │   ├── token.ts           # HMAC token generation (reads secret from SSM)
│       │   └── types.ts
│       └── package.json
├── infra/
│   └── ses-inbound.ts             # Raw Pulumi resources for SES receipt rules
└── spec.md
```

## 11. Open Decisions

| # | Decision | Options | Recommendation |
| --- | --- | --- | --- |
| 1 | Token default expiration | 1h, 24h, 7d, 30d | **24h** for CI, configurable |
| 2 | Token scoping | Global vs per-inbox | **Global** for v1, per-inbox scope in v2 |
| 3 | Rate limiting strategy | API Gateway throttling vs Lambda-level | **API Gateway** built-in throttling (simpler) |
| 4 | Raw email endpoint | 302 redirect vs inline body | **302 redirect** (avoids Lambda payload limits) |
| 5 | SDK: client-side MIME parsing | Include parser vs raw only | **Raw only** for v1, optional `parseEmail()` in v2 |
| 6 | Inbox validation | Any string vs alphanumeric+hyphens | **Alphanumeric + hyphens + dots**, max 64 chars |
| 7 | Multi-email recipients | Store per-recipient vs first-only | **First matching recipient** in the configured domain |
| 8 | S3 event trigger | S3 notification vs EventBridge | **S3 notification** via `bucket.notify()` (native SST) |

## 12. Trade-offs & Future Upgrades

| Area | MVP | Limitation | Future Upgrade |
| --- | --- | --- | --- |
| Auth tokens | HMAC-signed, stateless | No individual revocation. Rotate HMAC secret to revoke all. Short-lived tokens (default 24h) minimize risk. | Stored API keys in DynamoDB with per-key revocation. Same Bearer token interface — no breaking change to clients. |
