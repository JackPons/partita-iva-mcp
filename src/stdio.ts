/**
 * Entrypoint locale (stdio): utile per provare il server da Claude Desktop,
 * Claude Code o MCP Inspector senza pubblicare nulla.
 *   npm run stdio
 *   npm run inspect
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { creaServer } from "./server.js";

const server = creaServer();
await server.connect(new StdioServerTransport());
