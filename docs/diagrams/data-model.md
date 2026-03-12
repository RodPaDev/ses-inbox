# Data Model

## ERD

```mermaid
erDiagram
    EMAILS_TABLE {
        string inbox PK "partition key"
        string timestampMessageId PK "sort key: timestamp#messageId"
        string messageId "SES message ID"
        string sender "From header"
        string recipient "full recipient address"
        string subject "Subject header"
        string s3Key "S3 object key for raw eml"
        number receivedAt "Unix epoch ms"
        number ttl "DynamoDB TTL Unix epoch seconds"
    }

    S3_BUCKET {
        string key "emails/YYYY/MM/DD/messageId.eml"
        binary body "raw eml content"
    }

    HMAC_TOKEN {
        string sub "token subject random UUID"
        number iat "issued-at Unix epoch seconds"
        number exp "expiration Unix epoch seconds"
        string sig "HMAC-SHA256 signature hex"
    }

    EMAILS_TABLE ||--|| S3_BUCKET : "s3Key references object key"
    HMAC_TOKEN }|--|| EMAILS_TABLE : "authorizes queries on"
```

## DynamoDB Table Design

**Table:** `EmailsTable`

| Attribute | Type | Key | Description |
|-----------|------|-----|-------------|
| `PK` | String | Hash | Inbox identifier (local part of email address) |
| `SK` | String | Range | `{ISO timestamp}#{messageId}` for lexicographic ordering |
| `messageId` | String | — | SES message ID |
| `sender` | String | — | `From` header value |
| `recipient` | String | — | Full recipient address |
| `subject` | String | — | `Subject` header value |
| `s3Key` | String | — | S3 object key |
| `receivedAt` | Number | — | Unix epoch milliseconds |
| `ttl` | Number | TTL | Unix epoch seconds (7 days from ingestion) |

### Sort Key Format

```
SK = "2024-03-10T12:30:00.000Z#abc123def456"
       ^--- ISO 8601 timestamp    ^--- SES messageId
```

Lexicographic ordering on SK gives newest-first when queried with `ScanIndexForward: false`.

### Access Patterns

```mermaid
graph LR
    subgraph "Primary Key: PK + SK"
        A["PK = inbox"] --> B["SK = timestamp#messageId"]
    end

    subgraph Access Patterns
        Q1["List emails by inbox<br/><b>Query PK = inbox</b><br/>ScanIndexForward = false"]
        Q2["Paginate with cursor<br/><b>Query PK = inbox, SK &lt; cursor</b><br/>Limit = 50"]
        Q3["Get single email<br/><b>Query PK = inbox, SK = exact</b>"]
        Q4["Auto-expire<br/><b>TTL on ttl field</b><br/>DynamoDB handles deletion"]
    end

    B --> Q1
    B --> Q2
    B --> Q3
    B --> Q4
```

## S3 Key Format

```
emails/{YYYY}/{MM}/{DD}/{messageId}.eml
```

Date-partitioned for lifecycle management and human readability. SES deposits the raw `.eml` — no transformation.

## Lifecycle Coordination

```mermaid
graph TB
    subgraph "Lifecycle Coordination"
        DDB_TTL["DynamoDB TTL: 7 days<br/>(index entry deleted)"]
        S3_LC["S3 Lifecycle: 8 days<br/>(raw file deleted)"]
    end

    DDB_TTL -->|"1 day buffer"| S3_LC
```

- DynamoDB TTL removes the index entry at **7 days**
- S3 lifecycle removes the raw `.eml` at **8 days**
- The 1-day buffer prevents: index exists → pre-signed URL generated → S3 object already gone
- Once the index is deleted, no new pre-signed URLs can be generated, so the S3 object is safely orphaned for 1 day
