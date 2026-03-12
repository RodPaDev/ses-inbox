# API Contract

## Route Map

```mermaid
graph TB
    subgraph "API Gateway v2 — Routes"
        direction TB
        R1["GET /emails<br/>List and long-poll emails"]
        R2["GET /emails/{messageId}/raw<br/>Pre-signed .eml download"]
        R3["GET /health<br/>Health check + warmup"]
    end

    R1 --> AUTH["Bearer Token Auth"]
    R2 --> AUTH
    R3 --> NONE["No Auth"]
```

---

## `GET /emails`

Query emails for an inbox. Supports standard poll and long-poll.

### Query Parameters

| Param | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `inbox` | string | yes | — | Inbox identifier (local part of email address) |
| `wait` | boolean | no | `false` | Enable long-poll mode |
| `timeout` | number | no | `28` | Long-poll max wait in seconds (max: 28) |
| `cursor` | string | no | — | Pagination cursor (SK of last item) |
| `limit` | number | no | `50` | Max items per page (max: 100) |

### Response `200 OK`

```mermaid
classDiagram
    class ListEmailsResponse {
        +Email[] emails
        +string nextCursor
        +boolean hasMore
    }

    class Email {
        +string messageId
        +string inbox
        +string sender
        +string recipient
        +string subject
        +number receivedAt
        +string rawUrl
    }

    ListEmailsResponse *-- Email
```

### Errors

| Status | Error Code | Condition |
| --- | --- | --- |
| `400` | `MISSING_INBOX` | Missing `inbox` query parameter |
| `400` | `INVALID_INBOX` | Inbox contains invalid characters |
| `400` | `INVALID_LIMIT` | Limit out of range (1-100) |
| `401` | `UNAUTHORIZED` | Missing, invalid, or expired bearer token |
| `429` | `RATE_LIMITED` | Too many requests |

### Error Shape

```mermaid
classDiagram
    class ErrorResponse {
        +string error
        +string message
    }
```

---

## `GET /emails/{messageId}/raw`

Returns a `302` redirect to a pre-signed S3 URL for the raw `.eml` file. Pre-signed URL expires in **15 minutes**.

### Response

`302 Found` with `Location` header pointing to the pre-signed S3 URL.

### Errors

| Status | Error Code | Condition |
| --- | --- | --- |
| `401` | `UNAUTHORIZED` | Bad or expired bearer token |
| `404` | `NOT_FOUND` | messageId not found in DynamoDB |

---

## `GET /health`

No auth required. Used for health checks and Lambda warmup.

### Response `200 OK`

```mermaid
classDiagram
    class HealthResponse {
        +string status
        +number timestamp
    }
```

---

## Request / Response Flow

```mermaid
sequenceDiagram
    participant C as Client
    participant A as API Gateway
    participant L as Lambda
    participant D as DynamoDB

    Note over C,D: All API routes go through the same Lambda

    C->>A: GET /emails?inbox=x
    A->>L: routeKey = GET /emails
    L->>L: Verify Bearer token
    L->>D: Query(PK=x)
    D-->>L: Items
    L-->>A: { emails, nextCursor, hasMore }
    A-->>C: 200

    C->>A: GET /emails/id/raw
    A->>L: routeKey = GET /emails/{messageId}/raw
    L->>L: Verify Bearer token
    L->>D: GetItem → s3Key
    L-->>A: 302 Location: presigned-url
    A-->>C: 302

    C->>A: GET /health
    A->>L: routeKey = GET /health
    L-->>A: { status: ok }
    A-->>C: 200
```
