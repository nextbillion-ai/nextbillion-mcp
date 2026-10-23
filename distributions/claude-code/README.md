# NextBillion.ai plugin

NextBillion.ai location APIs as MCP tools for Claude: forward, reverse, structured and batch
geocoding, postcode lookup, place search, autosuggest, autocomplete, place lookup and browse,
turn-by-turn directions, distance matrices, isochrones, search along a route, and static map
images with overlays. Four documentation tools answer questions about the NextBillion.ai APIs
and SDKs from a copy of the official documentation bundled in this plugin, so they work
offline and send nothing anywhere.

## What the plugin runs, sends, and stores

- **Runs** one local MCP server, `dist/index.mjs`, started by Claude with Node.js from this
  plugin folder. It is a single self-contained file built from the open-source
  `nextbillion-mcp` package (https://github.com/nextbillion-ai/nextbillion-mcp); it installs
  nothing and downloads nothing at start-up.
- **Sends** the arguments of each API tool call (addresses, place names, coordinates, route
  and map parameters) to `https://api.nextbillion.io` over HTTPS, authenticated with your
  NextBillion.ai API key, and returns the response unchanged. Nothing else leaves your
  machine: no conversation content beyond the tool arguments, no files, no telemetry. The
  documentation tools make no network requests at all.
- **Stores** nothing. Your API key is asked for once when the plugin is enabled, kept by
  Claude in its secure credential store, and passed to the server only as the
  `NBAI_API_KEY` environment variable. The server writes no files.

## Setup

1. Get an API key at https://console.nextbillion.ai (or email support@nextbillion.ai).
2. Install the plugin from Anthropic's directory, or from this repository in Claude Code:

   ```
   /plugin install nextbillion-mcp --marketplace nextbillion-ai/nextbillion-mcp
   ```

   Claude prompts for the key as the plugin's **NextBillion.ai API key** setting.

3. Ask Claude for a route, a travel-time matrix, an address lookup, or how a NextBillion.ai
   API parameter works.

Documentation: https://docs.nextbillion.ai. Privacy policy: https://nextbillion.ai/privacy.
Support and issues: https://github.com/nextbillion-ai/nextbillion-mcp/issues.
