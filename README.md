# YouTube MCP Server

<div align="center">
  <img src="https://img.shields.io/badge/YouTube_API-v3-red" alt="YouTube API Version">
  <img src="https://img.shields.io/badge/MCP-Model_Context_Protocol-green" alt="MCP">
  <img src="https://img.shields.io/badge/Claude-compatible-blue" alt="Claude Compatible">
  <img src="https://img.shields.io/badge/license-MIT-orange" alt="License">
</div>

This is an MCP (Model Context Protocol) server that allows Claude and other AI assistants to interact with the YouTube API. The server provides tools to search for videos, get details about specific videos, search for channels, and obtain detailed information about channels.

## What is MCP?

Model Context Protocol (MCP) is an open standard developed by Anthropic (creators of Claude) to connect AI assistants with external data sources and tools. It allows models like Claude to access up-to-date information and perform actions in external systems in a standardized way.

MCP functions as a "universal bridge" for AI, providing a standardized way for models to access various content repositories, business services, or applications.

## Requirements

- Node.js v16 or higher
- A YouTube API key (obtained from the Google Developer Console)

## Installation

1. Clone this repository:
```bash
git clone https://github.com/Nocodeboy/youtube-mcp-server.git
cd youtube-mcp-server
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the project root and add your YouTube API key:
```
YOUTUBE_API_KEY=your_api_key_here
```

## Execution

To start the server, run:

```bash
npm start
```

## Integration with Claude Desktop

To use this MCP server with Claude Desktop, add the following configuration to your `claude_desktop_config.json` file (usually located in `%APPDATA%\Claude\` on Windows or `~/Library/Application Support/Claude/` on macOS):

```json
{
  "mcpServers": {
    "youtube": {
      "command": "node",
      "args": ["path/to/youtube-mcp-server/index.js"],
      "env": {
        "YOUTUBE_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

Replace `"path/to/youtube-mcp-server/index.js"` with the absolute path to the `index.js` file, and `"your_api_key_here"` with your YouTube API key.

## Available Tools

### 1. Search Videos

Search for videos on YouTube based on a query.

```
search_videos
```

Parameters:
- `query` (string, required): Search terms
- `maxResults` (number, optional): Maximum number of results (between 1 and 50)
- `pageToken` (string, optional): Token to get the next page of results

### 2. Get Video Details

Get detailed information about a specific video.

```
get_video_details
```

Parameters:
- `videoId` (string, required): YouTube video ID

### 3. Get Channel Details

Get detailed information about a specific channel.

```
get_channel_details
```

Parameters:
- `channelId` (string, required): YouTube channel ID

### 4. Search Channels

Search for channels on YouTube based on a query.

```
search_channels
```

Parameters:
- `query` (string, required): Search terms
- `maxResults` (number, optional): Maximum number of results (between 1 and 50)
- `pageToken` (string, optional): Token to get the next page of results

## Available Resources

- `youtube://popular/videos`: List of currently popular videos on YouTube

## Usage Examples

With Claude Desktop, you can ask questions like:

- "Search for Python programming videos"
- "Show me details of video with ID dQw4w9WgXcQ"
- "Search for cooking-related channels"
- "Give me information about the GoogleDevelopers channel"
- "What are the most popular videos right now?"

## Getting a YouTube API Key

To get a YouTube API key:

1. Go to the [Google Developer Console](https://console.developers.google.com/)
2. Create a new project (or select an existing one)
3. In the sidebar, select "API Library"
4. Search for "YouTube Data API v3" and enable it
5. In the sidebar, select "Credentials"
6. Click on "Create credentials" and select "API key"
7. Copy the generated key and use it in your `.env` file or in the Claude Desktop configuration

## Troubleshooting

If you encounter errors, check:

1. That you have installed all dependencies with `npm install`
2. That your YouTube API key is valid
3. That you have the YouTube Data API v3 enabled in your Google project
4. That you are using Node.js version 16 or higher
5. If you use Claude Desktop, check the logs in `%APPDATA%\Claude\logs\` (Windows) or `~/Library/Logs/Claude/` (macOS)

## Contributions

Contributions are welcome. You can collaborate in several ways:

1. Reporting bugs or issues
2. Suggesting new features
3. Sending pull requests with improvements or fixes
4. Improving documentation

## Support Me

If you find this project useful and want to show your support:

<a href="https://www.buymeacoffee.com/germanhuertas" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 60px !important;width: 217px !important;" ></a>

## License

This project is licensed under the MIT License. See the LICENSE file for more details.