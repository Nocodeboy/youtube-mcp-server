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

  setupHandlers() {
    this.setupResourceHandlers();
    this.setupToolHandlers();
  }

  setupResourceHandlers() {
    // Definimos un recurso que representa videos populares
    this.server.setRequestHandler(
      ListResourcesRequestSchema,
      async () => ({
        resources: [
          {
            uri: "youtube://popular/videos",
            name: "Videos populares en YouTube",
            mimeType: "application/json",
            description: "Lista de videos populares actualmente en YouTube",
          },
        ],
      })
    );

    // Manejador para leer recursos
    this.server.setRequestHandler(
      ReadResourceRequestSchema,
      async (request) => {
        if (request.params.uri === "youtube://popular/videos") {
          try {
            const response = await this.axiosInstance.get(
              API_CONFIG.ENDPOINTS.VIDEOS,
              {
                params: {
                  part: API_CONFIG.PART_DEFAULTS.VIDEOS,
                  chart: "mostPopular",
                  maxResults: API_CONFIG.MAX_RESULTS,
                },
              }
            );

            const formattedVideos = response.data.items.map((video) => ({
              title: video.snippet.title,
              id: video.id,
              url: `https://www.youtube.com/watch?v=${video.id}`,
              channelTitle: video.snippet.channelTitle,
              viewCount: video.statistics?.viewCount,
              publishedAt: video.snippet.publishedAt,
              description: video.snippet.description,
            }));

            return {
              contents: [
                {
                  uri: request.params.uri,
                  mimeType: "application/json",
                  text: JSON.stringify(formattedVideos, null, 2),
                },
              ],
            };
          } catch (error) {
            if (axios.isAxiosError(error)) {
              throw new McpError(
                ErrorCode.InternalError,
                `YouTube API error: ${error.response?.data?.error?.message || error.message}`
              );
            }
            throw error;
          }
        } else {
          throw new McpError(
            ErrorCode.InvalidRequest,
            `Unknown resource: ${request.params.uri}`
          );
        }
      }
    );
  }

  setupToolHandlers() {
    // Configurar herramientas disponibles
    this.server.setRequestHandler(
      ListToolsRequestSchema,
      async () => ({
        tools: [
          {
            name: "search_videos",
            description: "Buscar videos en YouTube",
            inputSchema: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "Términos de búsqueda",
                },
                maxResults: {
                  type: "number",
                  description: "Número máximo de resultados (entre 1 y 50)",
                  minimum: 1,
                  maximum: 50,
                },
                pageToken: {
                  type: "string",
                  description: "Token para obtener la siguiente página de resultados",
                },
              },
              required: ["query"],
            },
          },
          {
            name: "get_video_details",
            description: "Obtener detalles de un video específico",
            inputSchema: {
              type: "object",
              properties: {
                videoId: {
                  type: "string",
                  description: "ID del video de YouTube",
                },
              },
              required: ["videoId"],
            },
          },
          {
            name: "get_channel_details",
            description: "Obtener detalles de un canal específico",
            inputSchema: {
              type: "object",
              properties: {
                channelId: {
                  type: "string",
                  description: "ID del canal de YouTube",
                },
              },
              required: ["channelId"],
            },
          },
          {
            name: "search_channels",
            description: "Buscar canales en YouTube",
            inputSchema: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "Términos de búsqueda",
                },
                maxResults: {
                  type: "number",
                  description: "Número máximo de resultados (entre 1 y 50)",
                  minimum: 1,
                  maximum: 50,
                },
                pageToken: {
                  type: "string",
                  description: "Token para obtener la siguiente página de resultados",
                },
              },
              required: ["query"],
            },
          },
        ],
      })
    );

    // Manejador para llamadas a herramientas
    this.server.setRequestHandler(
      CallToolRequestSchema,
      async (request) => {
        try {
          switch (request.params.name) {
            case "search_videos":
              return await this.handleSearchVideos(request.params.arguments);
            
            case "get_video_details":
              return await this.handleGetVideoDetails(request.params.arguments);
            
            case "get_channel_details":
              return await this.handleGetChannelDetails(request.params.arguments);
            
            case "search_channels":
              return await this.handleSearchChannels(request.params.arguments);
            
            default:
              throw new McpError(
                ErrorCode.MethodNotFound,
                `Unknown tool: ${request.params.name}`
              );
          }
        } catch (error) {
          if (axios.isAxiosError(error)) {
            return {
              content: [
                {
                  type: "text",
                  text: `YouTube API error: ${error.response?.data?.error?.message || error.message}`,
                },
              ],
              isError: true,
            };
          }
          throw error;
        }
      }
    );
  }

  // Manejadores para cada herramienta

  async handleSearchVideos(args) {
    if (!args || typeof args !== 'object' || typeof args.query !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, "Invalid search arguments");
    }

    const { query, maxResults = API_CONFIG.MAX_RESULTS, pageToken } = args;

    const response = await this.axiosInstance.get(
      API_CONFIG.ENDPOINTS.SEARCH,
      {
        params: {
          part: API_CONFIG.PART_DEFAULTS.SEARCH,
          q: query,
          maxResults: Math.min(maxResults || API_CONFIG.MAX_RESULTS, 50),
          type: "video",
          pageToken,
        },
      }
    );

    const formattedResults = {
      videos: response.data.items.map((item) => ({
        title: item.snippet.title,
        id: item.id.videoId,
        url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
        channelTitle: item.snippet.channelTitle,
        publishedAt: item.snippet.publishedAt,
        description: item.snippet.description,
        thumbnail: item.snippet.thumbnails.high?.url || item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url,
      })),
      pageInfo: response.data.pageInfo,
      nextPageToken: response.data.nextPageToken,
      prevPageToken: response.data.prevPageToken,
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(formattedResults, null, 2),
        },
      ],
    };
  }