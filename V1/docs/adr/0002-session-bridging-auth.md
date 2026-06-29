# ADR-0002: Server-side NAVEX session management with OAuth/API-key facade auth

**Date**: 2026-06-12
**Status**: accepted (default inbound auth superseded by ADR-0005: Basic pass-through is the strict default; API key is opt-in)
**Deciders**: Aravind (Power Platform team), Claude (research)

## Context

NAVEX IRM API auth is session-cookie based: `SecurityService/Login` returns an encrypted cookie required on every call; `Ping` refreshes it. Power Platform connectors and Copilot Studio MCP connections support None / API key / OAuth 2.0 — not cookie jars. Cookies and passwords must never be exposed to clients.

## Decision

The facade service owns the NAVEX session lifecycle internally (service-account Login → cookie jar → periodic Ping → re-login on 401), with credentials in environment variables / Azure Key Vault. Outward-facing auth is Entra ID OAuth 2.0 (preferred) or API key per connection.

## Alternatives Considered

### Alternative 1: Pass NAVEX credentials/cookies through Power Platform
- **Pros**: Per-user NAVEX permissions preserved
- **Cons**: Connectors can't manage cookie lifecycles; credentials exposed in flow definitions; violates security requirements
- **Why not**: Technically awkward and insecure

### Alternative 2: Per-user OAuth → per-user NAVEX accounts (OBO mapping)
- **Pros**: Fine-grained NAVEX permissions per caller
- **Cons**: Requires a credential-mapping store and many NAVEX API accounts; high complexity
- **Why not**: Overkill for v1; revisit if audit requirements demand per-user identity (see Risks)

## Consequences

### Positive
- Zero cookie/credential exposure to Power Platform; clean secret isolation
- 30+ flows stop re-implementing Login/cookie handling individually

### Negative
- All calls run under one service account's Security Role (coarse permissions)
- NAVEX audit logs attribute actions to the service account, not the end user

### Risks
- Service account compromise = broad access → least-privilege Security Role, key rotation, facade-side audit log capturing the calling user/flow
- Unknown NAVEX session concurrency limits → conservative session pool + rate limiting; validate against the instance
