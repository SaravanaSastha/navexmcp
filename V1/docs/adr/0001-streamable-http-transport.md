# ADR-0001: Use Streamable HTTP transport for the MCP server

**Date**: 2026-06-12
**Status**: accepted
**Deciders**: Aravind (Power Platform team), Claude (research)

## Context

The MCP server's primary clients are Microsoft Copilot Studio agents. Copilot Studio consumes MCP servers through Power Platform custom connectors and supports only the Streamable HTTP transport; SSE was deprecated and unsupported after August 2025. The server must also be reachable as a hosted network service, not a local process.

## Decision

We expose the MCP server over Streamable HTTP at a single `/mcp` endpoint, declared in the connector OpenAPI spec with `x-ms-agentic-protocol: mcp-streamable-1.0`.

## Alternatives Considered

### Alternative 1: stdio transport
- **Pros**: Simplest for local dev tools (Claude Desktop, VS Code)
- **Cons**: Not reachable by cloud services
- **Why not**: Copilot Studio cannot connect to a local process; can still be added later for developer use

### Alternative 2: HTTP+SSE transport
- **Pros**: Older examples/templates use it
- **Cons**: Deprecated in the MCP spec; Copilot Studio dropped support Aug 2025
- **Why not**: Dead end for our primary client

## Consequences

### Positive
- Direct compatibility with Copilot Studio's MCP onboarding wizard
- One stateless-friendly endpoint; easy to host on Azure Container Apps/App Service

### Negative
- Requires session management for MCP protocol state across requests

### Risks
- Transport spec evolves; pin MCP SDK version and re-verify at upgrade time
