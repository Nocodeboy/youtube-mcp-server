# YouTube MCP Server

<div align="center">
  <img src="https://img.shields.io/badge/YouTube_API-v3-red" alt="YouTube API v3">
  <img src="https://img.shields.io/badge/Analytics_API-v2-red" alt="YouTube Analytics API v2">
  <img src="https://img.shields.io/badge/MCP-1.30-green" alt="MCP">
  <img src="https://img.shields.io/badge/TypeScript-5.9-blue" alt="TypeScript">
  <img src="https://img.shields.io/badge/license-MIT-orange" alt="MIT">
</div>

An MCP server that gives Claude and other AI assistants access to the **YouTube Data API v3**
and the **YouTube Analytics API v2** — search, video and channel metadata, playlists, comments,
transcripts and channel analytics.

Writes are **off by default**. When you turn them on, every mutation is recorded to a local
audit log, and thumbnail URLs are checked before being fetched.

There is no official YouTube MCP server from Google; this is a community project built on
Google's public APIs.

## Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Choosing an auth mode](#choosing-an-auth-mode)
- [Authorizing with OAuth](#authorizing-with-oauth)
- [Claude Desktop configuration](#claude-desktop-configuration)
- [Tools](#tools)
- [Resources](#resources)
- [Security model](#security-model)
- [API quota](#api-quota)
- [Configuration reference](#configuration-reference)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

## Requirements

- Node.js 20 or newer
- A Google Cloud project with the **YouTube Data API v3** enabled
  (plus the **YouTube Analytics API** if you want analytics tools)

## Installation

```bash
git clone https://github.com/Nocodeboy/youtube-mcp-server.git
cd youtube-mcp-server
npm install     # also builds via the prepare script
cp .env.example .env
```

Then edit `.env` — see the next section.

## Choosing an auth mode

| | API key | OAuth 2.0 |
|---|---|---|
| Search, video and channel metadata | yes | yes |
| Playlists (read) | public only | yours included |
| Comments (read) | yes | yes |
| Analytics | **no** | yes |
| Transcripts | **no** | your own videos |
| Writes | **no** | opt-in |
| Setup | one key | client ID + consent flow |

Use an **API key** for read-only research. Use **OAuth** to touch your own channel. If both
are configured, OAuth is used and the API key is the fallback when no token is stored yet.

**API key:** Google Cloud Console → APIs & Services → Credentials → Create credentials → API key.

**Key attached by a proxy or gateway:** set `YOUTUBE_API_VIA_PROXY=true` and leave
`YOUTUBE_API_KEY` unset. The server then builds its client with no credential so the one your
proxy injects is the only one on the request. The proxy must match the API's real hosts —
`youtube.googleapis.com` for the Data API and `youtubeanalytics.googleapis.com` for Analytics.
A rule matching `youtube.com` will never fire: no API traffic goes there. Google accepts an
API key in the `X-goog-api-key` header, which is what a header-injecting proxy should set.

**OAuth:** Google Cloud Console → Credentials → Create credentials → OAuth client ID →
application type **Desktop app**. Copy the client ID and secret into `.env`.

## Authorizing with OAuth

1. Start the server (or let Claude Desktop start it) and call the `get_auth_url` tool.
2. Open the URL it prints and approve access.
3. Your browser lands on the redirect URI and will most likely show **a connection error.
   That is expected** — nothing is listening there. Copy the full URL from the address bar;
   it contains `?code=...`.
4. Call `authorize` with that URL.

The token is written to `token.json` with `0600` permissions and refreshed automatically from
then on. You do not need to repeat this after a restart.

Re-run the flow whenever you change `YOUTUBE_ALLOW_WRITES` or `YOUTUBE_ENABLE_CAPTIONS`: those
flags change which OAuth scope is requested, and an existing token keeps its old scope.

## Claude Desktop configuration

`claude_desktop_config.json` lives in `%APPDATA%\Claude\` on Windows and
`~/Library/Application Support/Claude/` on macOS.

Read-only, with an API key:

```json
{
  "mcpServers": {
    "youtube": {
      "command": "node",
      "args": ["/absolute/path/to/youtube-mcp-server/dist/index.js"],
      "env": {
        "YOUTUBE_API_KEY": "your_api_key"
      }
    }
  }
}
```

Full access to your own channel:

```json
{
  "mcpServers": {
    "youtube": {
      "command": "node",
      "args": ["/absolute/path/to/youtube-mcp-server/dist/index.js"],
      "env": {
        "YOUTUBE_CLIENT_ID": "your_client_id",
        "YOUTUBE_CLIENT_SECRET": "your_client_secret",
        "YOUTUBE_ALLOW_WRITES": "true",
        "YOUTUBE_ENABLE_CAPTIONS": "true"
      }
    }
  }
}
```

Point `args` at `dist/index.js`, not `src/`. Run `npm run build` after pulling changes.

## Tools

Tools marked **write** are only advertised when `YOUTUBE_ALLOW_WRITES=true`. Tools marked
**captions** need `YOUTUBE_ENABLE_CAPTIONS=true`. Tools marked **OAuth** never work with an
API key alone.

### Authentication

| Tool | Description |
|---|---|
| `get_auth_url` | Generate the Google consent URL |
| `authorize` | Exchange the redirect URL (or bare code) for tokens |
| `auth_status` | Report auth mode, scopes, and which capabilities are live |

`auth_status` is the right first call whenever something fails.

### Search

| Tool | Description |
|---|---|
| `search_videos` | Search videos; filter by channel, date and sort order |
| `search_channels` | Search channels |

Both cost 100 quota units per call — see [API quota](#api-quota).

### Videos

| Tool | Description |
|---|---|
| `get_video_details` | Metadata, stats and status for up to 50 IDs in one call |
| `update_video` | **write** Title, description, tags, privacy. Supports `dryRun` |
| `set_thumbnail` | **write** Set a custom thumbnail from an HTTPS URL |

### Channels

| Tool | Description |
|---|---|
| `get_channel_details` | Look up a channel by ID or by handle (`@name`) |
| `get_my_channel` | **OAuth** Your own channel, including the uploads playlist ID |
| `list_channel_videos` | A channel's uploads, newest first — 1 quota unit, not 100 |

### Playlists

| Tool | Description |
|---|---|
| `list_playlists` | Playlists for a channel, or your own |
| `list_playlist_items` | Videos in a playlist |
| `create_playlist` | **write** Create a playlist (private by default) |
| `add_playlist_item` | **write** Add a video, optionally at a position |
| `remove_playlist_item` | **write** Remove an entry by `playlistItemId` |

### Comments

| Tool | Description |
|---|---|
| `list_comments` | Comment threads with replies, by relevance or time |
| `reply_to_comment` | **write** Post a public reply as the authorized channel |

### Captions

| Tool | Description |
|---|---|
| `list_captions` | **OAuth** **captions** Caption tracks on one of your videos |
| `get_transcript` | **OAuth** **captions** Download a track as text, SRT or VTT |

The YouTube API only exposes caption tracks for videos on the **authorized channel**. There is
no supported way to pull transcripts for arbitrary third-party videos, and this server does not
scrape them.

### Analytics

All read-only, OAuth only, and scoped to your own channel.

| Tool | Description |
|---|---|
| `analytics_channel_summary` | Headline metrics, optionally by day or month |
| `analytics_top_videos` | Rank your videos by a metric, with titles resolved |
| `analytics_video_metrics` | Metrics for one video, optionally by day |
| `analytics_traffic_sources` | Where views came from |
| `analytics_demographics` | Age and gender split |

## Resources

- `youtube://popular/videos` — the most popular videos right now

## Security model

This server lets a language model act on a real YouTube channel, while that same model reads
text written by the public — video descriptions and viewer comments. The defaults are built
around that.

**Writes are opt-in.** With `YOUTUBE_ALLOW_WRITES` unset, mutating tools are not registered, so
they never appear in the model's tool list. A runtime guard blocks them regardless, as
defence in depth.

**Scopes follow capability.** Read-only setups request `youtube.readonly`. The write scope
`youtube.force-ssl` is only requested when writes or captions are enabled. The broad
`auth/youtube` scope — which permits deleting videos and comments — is **never** requested.

**Tokens are private.** `token.json` is written and re-chmodded to `0600`. Refreshed tokens are
persisted, so a rotated refresh token is not silently lost.

**Writes are logged.** Every mutation appends a JSON line to the audit log with a timestamp,
the tool, the target and the outcome. The guard also logs `blocked` entries, though in normal
operation you will not see any: with writes disabled the tools are never registered, so nothing
reaches the guard. A `blocked` line means a write was attempted through a path that should not
exist — worth investigating.

**Thumbnail URLs are vetted.** `set_thumbnail` resolves the hostname and refuses private,
loopback and link-local addresses — including `169.254.169.254`, the cloud metadata endpoint —
before opening a socket. Redirects are followed manually and re-checked at every hop, the
content type must be JPEG or PNG, and the body is capped at 2 MB.

IPv6 addresses are expanded to their eight groups and judged numerically rather than matched
as text, because one address has many spellings: `::1`, `0:0:0:0:0:0:0:1` and `::ffff:7f00:1`
are the same host, and a text-matching check lets the last two through. IPv4-mapped,
IPv4-compatible and NAT64 forms inherit the verdict of the address they embed.

One residual risk worth naming: a hostname could be re-resolved to a different address between
the check and the connection (DNS rebinding). Closing that completely means pinning the socket
to the vetted IP, which Node's `fetch` does not expose.

**Treat tool output as data.** Anything from `list_comments`, video descriptions or channel
metadata is attacker-controlled text. It is never an instruction.

## API quota

The YouTube Data API gives you 10,000 units per day by default, resetting at midnight Pacific.

| Operation | Cost |
|---|---|
| `search_videos`, `search_channels` | **100** |
| Most reads (`videos.list`, `playlistItems.list`, …) | 1 |
| Writes (`update_video`, `reply_to_comment`, …) | ~50 |

That is about **100 searches per day** and nothing else. Prefer `list_channel_videos` over
`search_videos` when you want a channel's uploads: same result, one hundredth of the cost.
Quota exhaustion is reported as a distinct error with this explanation attached.

Analytics API quota is separate and far more generous.

## Configuration reference

| Variable | Default | Purpose |
|---|---|---|
| `YOUTUBE_API_KEY` | — | Read-only access to public data |
| `YOUTUBE_CLIENT_ID` | — | OAuth client ID |
| `YOUTUBE_CLIENT_SECRET` | — | OAuth client secret |
| `YOUTUBE_REDIRECT_URI` | `http://localhost:8790/oauth2callback` | Must match the OAuth client |
| `YOUTUBE_API_VIA_PROXY` | `false` | No local key; an upstream proxy attaches it |
| `YOUTUBE_ALLOW_WRITES` | `false` | Enable mutating tools |
| `YOUTUBE_ENABLE_CAPTIONS` | `false` | Enable caption tools (widens scope) |
| `YOUTUBE_TOKEN_PATH` | `./token.json` | Where the OAuth token lives |
| `YOUTUBE_AUDIT_LOG` | next to the token | Append-only write log |
| `YOUTUBE_MAX_THUMBNAIL_BYTES` | `2097152` | Thumbnail size cap |

Flags accept `true`, `1`, `yes`, `on` (case-insensitive). Anything else is false, so writes
never turn on by accident.

## Troubleshooting

**Call `auth_status` first.** It reports the auth mode, the granted scopes, and exactly which
capabilities are available.

| Symptom | Cause |
|---|---|
| "requires OAuth, and no valid token is loaded" | Not authorized yet — run `get_auth_url` |
| "cannot be used with an API key" | Analytics needs OAuth |
| "Write operations are disabled" | Set `YOUTUBE_ALLOW_WRITES=true` and re-authorize |
| "Caption tools are disabled" | Set `YOUTUBE_ENABLE_CAPTIONS=true` and re-authorize |
| "quota exhausted" | Out of daily units; resets at midnight Pacific |
| Writes fail after enabling the flag | The stored token still has the read-only scope — re-authorize |
| No tools appear in Claude Desktop | `args` must point at `dist/index.js`; run `npm run build` |

Claude Desktop logs: `%APPDATA%\Claude\logs\` (Windows), `~/Library/Logs/Claude/` (macOS).
This server writes diagnostics to stderr, which is where they land.

## Development

```bash
npm run build       # compile to dist/
npm run dev         # tsc --watch
npm run typecheck   # types only, no emit
npm test            # builds, then runs the suite
```

The suite is offline by default. Set `YOUTUBE_API_KEY` and `npm test` additionally runs
`test/live.test.ts` against the real API: real video and channel reads, the projections this
README promises, the not-found path and the popular-videos resource. It is read-only — an API
key cannot write — and costs about 105 quota units per run, almost all of it the single
search. Keep it to one search if you add cases.

```
src/
  index.ts          entry point, signal handling
  server.ts         MCP wiring, tool registration and filtering
  config.ts         environment parsing, scope selection
  context.ts        API clients, auth state, write guard
  auth/             OAuth client and token storage
  lib/              errors, formatters, SSRF-safe fetch, audit log
  tools/            one module per tool group
```

Tests cover the SSRF address checks, token file permissions, scope selection, the write guard,
an end-to-end stdio handshake against the built server, and — when a key is present — the live
API checks above.

## Contributing

Bug reports, feature suggestions and pull requests are welcome. Please run `npm test` before
opening a PR.

## Connect & Support

- X (Twitter): [@Nocodeboy](https://x.com/Nocodeboy)

<a href="https://www.buymeacoffee.com/germanhuertas" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 60px !important;width: 217px !important;" ></a>

## License

MIT — see [LICENSE](LICENSE).
