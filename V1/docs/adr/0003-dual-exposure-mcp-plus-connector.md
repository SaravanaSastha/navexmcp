# ADR-0003: Dual exposure — MCP endpoint for agents + REST/custom connector for cloud flows

**Date**: 2026-06-12
**Status**: accepted
**Deciders**: Aravind (Power Platform team), Claude (research)

## Context

The team runs 30+ Power Automate cloud flows calling NAVEX via raw HTTP actions, and wants Copilot Studio/agent capability. Classic cloud flows cannot call MCP tools — MCP is consumed by agents (Copilot Studio, agent flows). A connector is the native modernization path for flows; MCP is the native path for agents.

## Decision

One facade service exposes two front doors over a shared core (NavexClient, DCF metadata cache, validation, logging): `POST /mcp` (Streamable HTTP for agents) and `/api/*` REST endpoints published as an OpenAPI spec → Power Platform custom connector for the existing flows.

## Alternatives Considered

### Alternative 1: MCP server only
- **Pros**: Less surface to build
- **Cons**: Leaves the 30+ cloud flows on raw HTTP actions with duplicated cookie logic — the team's stated pain
- **Why not**: Doesn't solve the primary operational problem

### Alternative 2: Custom connector only (no MCP)
- **Pros**: Solves flows; simplest
- **Cons**: Copilot Studio agents get static connector actions instead of dynamic MCP tool discovery; no tool descriptions tuned for orchestration
- **Why not**: Forfeits the agent capability the team explicitly wants

### Alternative 3: Two separate services
- **Pros**: Independent scaling/deploys
- **Cons**: Duplicated NAVEX session logic, double the ops burden
- **Why not**: Shared core in one deployable is simpler at this scale

## Consequences

### Positive
- Single place for session management, retries, rate limiting, audit
- Flows migrate incrementally (HTTP action → connector action, same shapes)
- DLP policies govern both surfaces via connectors

### Negative
- One service serves two contract styles; needs clear module boundaries (tools/ vs api/)

### Risks
- Connector certification not required (org-internal custom connector), but solution-aware deployment across environments needs ALM planning
