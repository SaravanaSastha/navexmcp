# ADR-0004: TypeScript + official MCP SDK + Zod stack, metadata-driven tools

**Date**: 2026-06-12
**Status**: accepted
**Deciders**: Aravind (Power Platform team), Claude (research)

## Context

The project spec mandates production-grade quality: strong typing, validation, observability, testing. NAVEX's Dynamic Content Framework means component/field structures are tenant-specific and must be discovered at runtime, never hardcoded.

## Decision

Build with TypeScript/Node.js, the official `@modelcontextprotocol/sdk` (Streamable HTTP server transport), Zod for input/output validation, structured logging + OpenTelemetry, Vitest for tests. Tools accept component aliases and resolve IDs/fields at runtime through a cached metadata layer (`GetComponentList`/`GetFieldList`, TTL-based invalidation).

## Alternatives Considered

### Alternative 1: C#/.NET MCP SDK
- **Pros**: Azure-native, familiar to many Microsoft shops
- **Cons**: Project spec specifies TypeScript; TS MCP SDK is the reference implementation
- **Why not**: Spec alignment and SDK maturity

### Alternative 2: Hardcoded tool-per-component design
- **Pros**: Simpler tool schemas
- **Cons**: Breaks on every DCF change; violates the no-hardcoded-IDs requirement
- **Why not**: DCF is dynamic by design

## Consequences

### Positive
- End-to-end typing from Zod schemas to NAVEX client; reference-quality SDK support for Streamable HTTP
- Metadata cache cuts redundant discovery calls and keeps tools tenant-portable

### Negative
- Cache staleness window after admin schema changes (mitigate: short TTL + manual invalidation tool)

### Risks
- MCP SDK API drift — pin versions, review release notes at upgrade
