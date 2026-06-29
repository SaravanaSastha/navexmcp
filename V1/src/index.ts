import { loadConfig } from "./config.js";
import { createApp } from "./server/http.js";
import { logger } from "./utils/logger.js";

const config = loadConfig();
const { app, sessions } = createApp(config);

const server = app.listen(config.port, () => {
  logger.info({ port: config.port }, "NAVEX IRM MCP server listening (POST /mcp, REST /api, GET /healthz)");
});

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  server.close();
  await sessions.shutdown(); // logs out of NAVEX sessions
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
