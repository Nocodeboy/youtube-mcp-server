#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { YouTubeContext } from "./context.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

async function main(): Promise<void> {
  // Everything diagnostic goes to stderr: stdout is the MCP transport, and a stray
  // console.log would corrupt the protocol stream.
  console.error(`[${SERVER_NAME}] v${SERVER_VERSION} starting`);

  const config = loadConfig();
  const ctx = new YouTubeContext(config);
  await ctx.initialize();

  const server = createServer(ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[${SERVER_NAME}] connected over stdio`);

  const shutdown = async (signal: string): Promise<void> => {
    console.error(`[${SERVER_NAME}] ${signal} received, shutting down`);
    try {
      await server.close();
    } finally {
      process.exit(0);
    }
  };
  // SIGTERM matters as much as SIGINT: it is what process supervisors send.
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  process.on("unhandledRejection", (reason) => {
    console.error(`[${SERVER_NAME}] unhandled rejection:`, reason);
  });
}

main().catch((error) => {
  console.error(`[${SERVER_NAME}] fatal:`, error instanceof Error ? error.message : error);
  process.exit(1);
});
