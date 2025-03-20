import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import dotenv from "dotenv";

// Cargar variables de entorno
dotenv.config();

const API_KEY = process.env.YOUTUBE_API_KEY;
if (!API_KEY) {
  throw new Error("YOUTUBE_API_KEY environment variable is required");
}

const API_CONFIG = {
  BASE_URL: "https://www.googleapis.com/youtube/v3",
  ENDPOINTS: {
    SEARCH: "search",
    VIDEOS: "videos",
    CHANNELS: "channels",
  },
  PART_DEFAULTS: {
    SEARCH: "snippet",
    VIDEOS: "snippet,statistics",
    CHANNELS: "snippet,statistics",
  },
  MAX_RESULTS: 10,
};

/**
 * Servidor MCP para interactuar con la API de YouTube
 */
class YouTubeMCPServer {
  constructor() {
    this.server = new Server(
      {
        name: "yt-mcp-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    // Configurar instancia de axios
    this.axiosInstance = axios.create({
      baseURL: API_CONFIG.BASE_URL,
      params: {
        key: API_KEY,
      },
    });

    this.setupHandlers();
    this.setupErrorHandling();
  }

  setupErrorHandling() {
    this.server.onerror = (error) => {
      console.error("[MCP Error]", error);
    };

    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }