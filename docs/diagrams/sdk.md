# SDK Public API

## Class Diagram

```mermaid
classDiagram
    class SesInboxClient {
        +constructor(config: ClientConfig)
        +listEmails(params: ListParams): Promise~ListResult~
        +waitForEmail(params: WaitParams): Promise~Email~
        +waitForEmails(params: WaitManyParams): Promise~Email[]~
        +getRawEmail(messageId: string): Promise~string~
    }

    class ClientConfig {
        +string apiUrl
        +string token
    }

    class ListParams {
        +string inbox
        +string cursor
        +number limit
    }

    class WaitParams {
        +string inbox
        +number timeout
        +EmailFilter filter
    }

    class WaitManyParams {
        +string inbox
        +number count
        +number timeout
        +EmailFilter filter
    }

    class EmailFilter {
        +string|RegExp subject
        +string|RegExp sender
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

    class ListResult {
        +Email[] emails
        +string nextCursor
        +boolean hasMore
    }

    class SesInboxSession {
        +create(config: SessionConfig) SesInboxSession$
        +SesInboxClient client
        +string domain
        +generateAddress(prefix?: string) string
    }

    class SessionConfig {
        +string apiUrl
        +string region
        +string secretPath
        +number tokenTtl
    }

    SesInboxClient --> ClientConfig : configured by
    SesInboxClient --> ListParams : accepts
    SesInboxClient --> WaitParams : accepts
    SesInboxClient --> WaitManyParams : accepts
    SesInboxClient --> Email : returns
    SesInboxClient --> ListResult : returns
    WaitParams --> EmailFilter : optional filter
    WaitManyParams --> EmailFilter : optional filter
    SesInboxSession --> SessionConfig : configured by
    SesInboxSession --> SesInboxClient : contains
```

## Session Flow

`SesInboxSession.create()` reads the HMAC signing key from SSM, generates a token locally, and returns a session with an authenticated client.

```mermaid
sequenceDiagram
    participant App as Application
    participant Session as SesInboxSession
    participant SSM as SSM Parameter Store
    participant Client as SesInboxClient
    participant API as ses-inbox API

    App->>Session: create({ region, secretPath, apiUrl })
    Session->>SSM: GetParameter (HMAC signing key)
    SSM-->>Session: signingKey
    Session->>Session: Sign token locally (HMAC-SHA256)
    Session->>Session: Create SesInboxClient with token
    Session-->>App: SesInboxSession { client, generateAddress() }

    App->>App: addr = session.generateAddress("intake")
    Note over App: addr = "intake-a1b2c3@receive.domain.com"

    App->>Client: waitForEmail({ inbox: "intake-a1b2c3", timeout: 10000 })
    Client->>API: GET /emails?inbox=intake-a1b2c3&wait=true
    API-->>Client: { emails: [{ subject: "Welcome" }] }
    Client-->>App: Email { subject, sender, ... }
```

## Two Entry Points

| Entry Point | When to Use |
| --- | --- |
| `SesInboxSession.create()` | Auto-provisions a token by reading the HMAC secret from SSM. Requires AWS credentials. |
| `new SesInboxClient()` | Bring your own token. Plain HTTP client, no AWS SDK dependency. |

## Method Reference

| Method | Description |
| --- | --- |
| `listEmails(params)` | Query emails for an inbox. Cursor-based pagination. |
| `waitForEmail(params)` | Long-polls until a single matching email arrives or timeout. |
| `waitForEmails(params)` | Long-polls until `count` matching emails arrive or timeout. |
| `getRawEmail(messageId)` | Returns pre-signed S3 URL for the raw `.eml` file. |
| `generateAddress(prefix?)` | Generates a unique email address under the configured domain. |
