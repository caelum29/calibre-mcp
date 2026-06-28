---
name: youtube-research
description: "Search YouTube, list a channel's videos, and read video transcripts including long lectures. Use whenever the user wants to find YouTube videos, get all videos from a channel, summarize/read a video or lecture, extract a transcript, or research a topic via YouTube. Orchestrates the youtube (Data API search + metadata) and youtube-transcript (paginated/timed transcripts) MCP servers."
---

# YouTube Research

Two MCP servers. `youtube` **finds** videos and reads short ones; `youtube-transcript`
**reads long videos** with pagination + timestamps.

## Picking the transcript tool

- **Short/medium video, or several at once** → `youtube` › `getTranscripts` (batch, zero API quota).
- **Long lecture (30 min+)** → `youtube-transcript` › `get_transcript` (paginates via `next_cursor`,
  so it won't dump 50k+ tokens at once) or `get_timed_transcript` (timestamps, to jump to sections).

## `youtube` — `@kirbah/mcp-youtube` (Data API, needs `YOUTUBE_API_KEY`)
- `searchVideos` — `{ query, channelId?, order?, type?, maxResults?, videoDuration?, recency?, regionCode? }`.
  **Also the channel-listing tool**: `channelId` + `order:"date"` → recent; `order:"viewCount"` → top.
  `query` is required — use a throwaway value (e.g. `"a"`) when filtering by channel only.
- `getTranscripts` — `{ videoIds, lang?, format? }`. Batch, zero quota. Output has HTML entities (`&#39;`).
- `getVideoDetails` — `{ videoIds, includeTags?, descriptionDetail? }` → metadata + stats.
- `getChannelStatistics` — `{ channelIds }` → subs, view/video count, channelId, createdAt.
- `getVideoComments`, `getTrendingVideos`, `getVideoCategories`.
- ⚠️ `getChannelTopVideos` is **broken** with API-key-only auth. Use `searchVideos` + `channelId` + `order:"viewCount"`.

## `youtube-transcript` — `jkawamoto/mcp-youtube-transcript`
- `get_transcript` — `{ url, lang?, next_cursor? }`. `lang` defaults `en` (use `ru` for Russian).
  **Loop on `next_cursor` until it's `null`** to read a full long lecture in chunks.
- `get_timed_transcript` — same, with timestamps (navigate long talks by section).
- `get_video_info` — `{ url }` → title, description, uploader, date, duration.
- `get_available_languages` — `{ url }` → which subtitle langs exist (check before picking `lang` for RU/EN).
- URLs are full: `https://www.youtube.com/watch?v=<id>`.

## Workflows

**List a channel's videos:** resolve channelId (`getChannelStatistics` or any `searchVideos` hit) →
`searchVideos({ query:"a", channelId, order:"date", maxResults })`.

**Read a long lecture:** `get_available_languages` (if RU/EN unsure) →
`get_transcript({ url, lang })`, repeat with returned `next_cursor` until `null`, concatenate →
synthesize. Use `get_timed_transcript` if the user wants section/timestamp references.

**Research a topic:** `searchVideos({ query })` → pick videos → batch `getTranscripts` (short) or
loop `get_transcript` (long) → synthesize.

## Notes
- `YOUTUBE_API_KEY` lives in `.mcp.json` (gitignored) and the Claude Desktop config.
- If tools aren't visible, the MCP servers need a session restart to load.