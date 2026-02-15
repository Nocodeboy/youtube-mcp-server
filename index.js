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
import { google } from "googleapis";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Cargar variables de entorno desde la carpeta del proyecto
dotenv.config({ path: path.join(__dirname, ".env") });

const TOKEN_PATH = path.join(__dirname, "token.json");

const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;
const REDIRECT_URI = "http://localhost:1";

/**
 * Servidor MCP para interactuar con la API de YouTube (v3) con soporte de escritura y OAuth
 */
class YouTubeMCPServer {
  constructor() {
    this.server = new Server(
      {
        name: "youtube-mcp-server",
        version: "2.0.0",
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    this.youtube = null;
    this.oauth2Client = null;

    this.setupHandlers();
    this.setupErrorHandling();
  }

  async initialize() {
    console.error(`Checking credentials... ID: ${CLIENT_ID ? 'Present' : 'Missing'}, Secret: ${CLIENT_SECRET ? 'Present' : 'Missing'}`);
    
    if (CLIENT_ID && CLIENT_SECRET) {
      this.oauth2Client = new google.auth.OAuth2(
        CLIENT_ID,
        CLIENT_SECRET,
        REDIRECT_URI
      );

      try {
        const tokenContent = await fs.readFile(TOKEN_PATH, "utf-8");
        const tokens = JSON.parse(tokenContent);
        this.oauth2Client.setCredentials(tokens);
        this.youtube = google.youtube({ version: "v3", auth: this.oauth2Client });
        console.error("YouTube API initialized with OAuth2");
      } catch (error) {
        console.error("No token found or invalid token. Run 'get_auth_url' to authorize.");
        if (process.env.YOUTUBE_API_KEY) {
          this.youtube = google.youtube({ version: "v3", auth: process.env.YOUTUBE_API_KEY });
          console.error("YouTube API initialized with API Key (Read-only mode)");
        }
      }
    } else if (process.env.YOUTUBE_API_KEY) {
      this.youtube = google.youtube({ version: "v3", auth: process.env.YOUTUBE_API_KEY });
      console.error("YouTube API initialized with API Key (Read-only mode)");
    } else {
      throw new Error("Missing YouTube credentials (API Key or Client ID/Secret)");
    }
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
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: "youtube://popular/videos",
          name: "Videos populares en YouTube",
          mimeType: "application/json",
          description: "Lista de videos populares actualmente en YouTube",
        },
      ],
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      if (request.params.uri === "youtube://popular/videos") {
        try {
          const response = await this.youtube.videos.list({
            part: ["snippet", "statistics"],
            chart: "mostPopular",
            maxResults: 10,
          });

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
          throw new McpError(ErrorCode.InternalError, `YouTube API error: ${error.message}`);
        }
      }
      throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${request.params.uri}`);
    });
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "get_auth_url",
          description: "Generar la URL de autorización de Google para habilitar funciones de escritura",
          inputSchema: { type: "object", properties: {} }
        },
        {
          name: "authorize",
          description: "Completar el proceso de autorización",
          inputSchema: {
            type: "object",
            properties: {
              authUrl: { type: "string", description: "La URL de redirección completa" }
            },
            required: ["authUrl"]
          }
        },
        {
          name: "search_videos",
          description: "Buscar videos en YouTube",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string" },
              maxResults: { type: "number", minimum: 1, maximum: 50 },
              pageToken: { type: "string" }
            },
            required: ["query"]
          }
        },
        {
          name: "get_video_details",
          description: "Obtener detalles de un video específico",
          inputSchema: {
            type: "object",
            properties: {
              videoId: { type: "string" }
            },
            required: ["videoId"]
          }
        },
        {
          name: "list_comments",
          description: "Listar comentarios de un video",
          inputSchema: {
            type: "object",
            properties: {
              videoId: { type: "string" },
              maxResults: { type: "number", minimum: 1, maximum: 100 }
            },
            required: ["videoId"]
          }
        },
        {
          name: "reply_to_comment",
          description: "Responder a un comentario de YouTube",
          inputSchema: {
            type: "object",
            properties: {
              parentId: { type: "string" },
              text: { type: "string" }
            },
            required: ["parentId", "text"]
          }
        },
        {
          name: "update_video",
          description: "Actualizar título, descripción o etiquetas de un video",
          inputSchema: {
            type: "object",
            properties: {
              videoId: { type: "string" },
              title: { type: "string" },
              description: { type: "string" },
              tags: { type: "array", items: { type: "string" } },
              privacyStatus: { type: "string", enum: ["public", "unlisted", "private"] }
            },
            required: ["videoId"]
          }
        },
        {
          name: "set_thumbnail",
          description: "Establecer una miniatura personalizada para un video",
          inputSchema: {
            type: "object",
            properties: {
              videoId: { type: "string" },
              imageUrl: { type: "string" }
            },
            required: ["videoId", "imageUrl"]
          }
        }
      ]
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      try {
        switch (name) {
          case "get_auth_url": return await this.handleGetAuthUrl();
          case "authorize": return await this.handleAuthorize(args);
          case "search_videos": return await this.handleSearchVideos(args);
          case "get_video_details": return await this.handleGetVideoDetails(args);
          case "list_comments": return await this.handleListComments(args);
          case "reply_to_comment": return await this.handleReplyToComment(args);
          case "update_video": return await this.handleUpdateVideo(args);
          case "set_thumbnail": return await this.handleSetThumbnail(args);
          default: throw new McpError(ErrorCode.MethodNotFound, `Tool not found: ${name}`);
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true
        };
      }
    });
  }

  async handleGetAuthUrl() {
    if (!this.oauth2Client) throw new Error("OAuth2 not configured. Set CLIENT_ID and CLIENT_SECRET.");
    const url = this.oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: [
        "https://www.googleapis.com/auth/youtube",
        "https://www.googleapis.com/auth/youtube.force-ssl"
      ],
      prompt: "consent"
    });
    return { content: [{ type: "text", text: `Visita esta URL para autorizar: ${url}\nLuego usa 'authorize' con la URL resultante.` }] };
  }

  async handleAuthorize({ authUrl }) {
    if (!this.oauth2Client) throw new Error("OAuth2 not configured.");
    let code = authUrl;
    if (authUrl.includes("code=")) {
      const urlParams = new URL(authUrl);
      code = urlParams.searchParams.get("code");
    }
    const { tokens } = await this.oauth2Client.getToken(code);
    await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    this.oauth2Client.setCredentials(tokens);
    this.youtube = google.youtube({ version: "v3", auth: this.oauth2Client });
    return { content: [{ type: "text", text: "¡Autorización exitosa!" }] };
  }

  async handleSearchVideos({ query, maxResults = 10, pageToken }) {
    const res = await this.youtube.search.list({
      part: ["snippet"],
      q: query,
      maxResults,
      type: ["video"],
      pageToken
    });
    return { content: [{ type: "text", text: JSON.stringify(res.data, null, 2) }] };
  }

  async handleGetVideoDetails({ videoId }) {
    const res = await this.youtube.videos.list({
      part: ["snippet", "statistics", "status"],
      id: [videoId]
    });
    return { content: [{ type: "text", text: JSON.stringify(res.data.items[0], null, 2) }] };
  }

  async handleListComments({ videoId, maxResults = 20 }) {
    const res = await this.youtube.commentThreads.list({
      part: ["snippet", "replies"],
      videoId,
      maxResults
    });
    return { content: [{ type: "text", text: JSON.stringify(res.data.items, null, 2) }] };
  }

  async handleReplyToComment({ parentId, text }) {
    const res = await this.youtube.comments.insert({
      part: ["snippet"],
      requestBody: {
        snippet: {
          parentId,
          textOriginal: text
        }
      }
    });
    return { content: [{ type: "text", text: `Respuesta enviada: ${res.data.id}` }] };
  }

  async handleUpdateVideo({ videoId, title, description, tags, privacyStatus }) {
    const video = await this.youtube.videos.list({ part: ["snippet", "status"], id: [videoId] });
    if (!video.data.items.length) throw new Error("Video no encontrado");
    
    const snippet = video.data.items[0].snippet;
    const status = video.data.items[0].status;

    if (title) snippet.title = title;
    if (description) snippet.description = description;
    if (tags) snippet.tags = tags;
    if (privacyStatus) status.privacyStatus = privacyStatus;

    await this.youtube.videos.update({
      part: ["snippet", "status"],
      requestBody: {
        id: videoId,
        snippet,
        status
      }
    });
    return { content: [{ type: "text", text: `Video actualizado con éxito.` }] };
  }

  async handleSetThumbnail({ videoId, imageUrl }) {
    const axios = (await import("axios")).default;
    const imageRes = await axios.get(imageUrl, { responseType: "stream" });
    await this.youtube.thumbnails.set({
      videoId,
      media: {
        mimeType: imageRes.headers["content-type"],
        body: imageRes.data
      }
    });
    return { content: [{ type: "text", text: "Miniatura actualizada." }] };
  }

  async run() {
    await this.initialize();
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

const server = new YouTubeMCPServer();
server.run().catch(console.error);
