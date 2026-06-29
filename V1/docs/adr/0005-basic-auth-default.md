# ADR-0005: NAVEX username/password (Basic) is the strict default inbound auth

**Date**: 2026-06-12
**Status**: accepted (supersedes the auth-default portion of ADR-0002)
**Deciders**: Aravind (Power Platform team), Claude

## Context

ADR-0002 proposed API key / OAuth as the outward auth with a shared NAVEX service account. During local validation the team decided callers should use their own NAVEX credentials for now: per-user permissions and NAVEX-side audit attribution matter more than connection simplicity, and no service account is provisioned yet.

## Decision

HTTP Basic auth with NAVEX username/password pass-through is the default and only out-of-the-box mechanism for both `/mcp` and `/api/*`. The facade logs into NAVEX as the calling user and isolates that session per credential set. API-key auth is a hard opt-in: it activates only when `API_KEYS` AND the service-account credentials are configured; mismatched config fails at startup.

## Alternatives Considered

### Alternative 1: API key default (shared service account)
- **Pros**: One connection to manage; simpler Copilot Studio wizard onboarding
- **Cons**: Coarse permissions; NAVEX audit logs blame the service account; service account not yet provisioned
- **Why not**: Team explicitly chose per-user credentials for now

### Alternative 2: Entra ID OAuth in front (APIM)
- **Pros**: Best long-term governance
- **Cons**: Requires app registration + APIM; overhead not justified during local/pilot phase
- **Why not**: Deferred; can be added at the gateway without code changes

## Consequences

### Positive
- Per-user NAVEX permissions and audit attribution preserved end-to-end
- No shared secrets to rotate; removing a NAVEX user revokes facade access automatically

### Negative
- Copilot Studio's MCP onboarding wizard doesn't offer Basic auth — the MCP connector must be imported manually (Option 2, `docs/connector/mcp-connector.swagger.yaml`)
- Each flow/agent connection stores a NAVEX password in Power Platform connections

### Risks
- Password rotation breaks connections until updated → document rotation procedure
- Future API-key enablement must use a least-privilege service account (see ADR-0002 mitigations)
