# Flows

## Email Ingestion Flow

```mermaid
sequenceDiagram
    participant Sender as Email Sender
    participant MX as MX Record (Route 53)
    participant SES as SES Inbound
    participant S3 as S3 Bucket
    participant Lambda as Ingest Lambda
    participant DDB as DynamoDB

    Sender->>MX: SMTP to anything@receive.domain.com
    MX->>SES: Route via MX record
    SES->>S3: Store raw .eml (Receipt Rule)
    S3->>Lambda: S3 ObjectCreated event
    Lambda->>Lambda: Extract inbox from recipient<br/>(local part of address)
    Lambda->>Lambda: Parse From, Subject from headers<br/>(no full MIME parse)
    Lambda->>DDB: PutItem(inbox, timestamp#messageId,<br/>sender, subject, s3Key, recipient)

    Note over DDB: TTL auto-expires after 7 days
    Note over S3: Lifecycle rule deletes after 8 days
```

## Query & Long-Poll Flow

```mermaid
sequenceDiagram
    participant Client as API Client
    participant APIGW as API Gateway v2
    participant Lambda as API Lambda
    participant DDB as DynamoDB
    participant S3 as S3 Bucket

    rect rgb(240, 248, 255)
        Note over Client,DDB: Standard Poll
        Client->>APIGW: GET /emails?inbox=test-42&cursor=xxx
        APIGW->>Lambda: Proxy event
        Lambda->>DDB: Query(PK=test-42, SK > cursor, Limit=50)
        DDB-->>Lambda: Items[]
        Lambda-->>APIGW: 200 { emails[], nextCursor }
        APIGW-->>Client: Response
    end

    rect rgb(255, 248, 240)
        Note over Client,DDB: Long-Poll (wait=true)
        Client->>APIGW: GET /emails?inbox=test-42&wait=true
        APIGW->>Lambda: Proxy event
        loop Every 2s, up to 28s
            Lambda->>DDB: Query(PK=test-42)
            DDB-->>Lambda: Items[]
            alt Items found
                Lambda-->>APIGW: 200 { emails[] }
                APIGW-->>Client: Response
            end
        end
        Lambda-->>APIGW: 200 { emails: [] }
        APIGW-->>Client: Empty response (timeout)
    end

    rect rgb(240, 255, 240)
        Note over Client,S3: Raw Email Download
        Client->>APIGW: GET /emails/{messageId}/raw
        APIGW->>Lambda: Proxy event
        Lambda->>S3: Generate pre-signed GET URL (15 min)
        S3-->>Lambda: Pre-signed URL
        Lambda-->>APIGW: 302 Redirect to pre-signed URL
        APIGW-->>Client: Redirect → download .eml
    end
```

## Auth Flow

```mermaid
sequenceDiagram
    participant App as Application
    participant SDK as ses-inbox SDK
    participant SSM as SSM Parameter Store
    participant APIGW as API Gateway v2
    participant API as API Lambda

    rect rgb(248, 240, 255)
        Note over App,SSM: Token Generation (via SDK, requires AWS credentials)
        App->>SDK: SesInboxSession.create({ region })
        SDK->>SSM: GetParameter (HMAC signing key)
        SSM-->>SDK: signingKey
        SDK->>SDK: Generate token payload {sub, iat, exp}
        SDK->>SDK: HMAC-SHA256(payload, signingKey)
        SDK-->>App: SesInboxSession { client, token }
    end

    rect rgb(240, 255, 248)
        Note over App,API: API Access (Bearer token)
        App->>APIGW: GET /emails?inbox=x<br/>Authorization: Bearer token
        APIGW->>API: Proxy event
        API->>API: Decode token → payload + signature
        API->>API: Read HMAC signing key (cached)
        API->>API: Recompute HMAC-SHA256(payload, key)
        alt Signature matches and not expired
            API->>API: Proceed with request
        else Invalid or expired
            API-->>APIGW: 401 Unauthorized
        end
    end
```

## HMAC Token Structure

```mermaid
graph LR
    subgraph "Token Format"
        T["base64url(payload) . hex(signature)"]
    end

    subgraph Payload
        F1["sub: random UUID"]
        F2["iat: issued-at epoch sec"]
        F3["exp: expiration epoch sec"]
    end

    subgraph Signing
        S1["HMAC-SHA256(base64url_payload, signingKey)"]
    end

    F1 --> T
    F2 --> T
    F3 --> T
    S1 --> T
```

**Signing steps:**

1. Encode payload as base64url: `{ sub, iat, exp }`
2. Sign the base64url string with HMAC-SHA256 using the signing key
3. Token = `{base64url_payload}.{hex_signature}`

**Verification (no DB lookup):**

1. Split token on `.` → `payload`, `signature`
2. Recompute `HMAC-SHA256(payload, signingKey)`
3. Constant-time compare with `signature`
4. Decode payload, check `exp > now`
