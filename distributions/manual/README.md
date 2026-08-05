# Manual configuration (any MCP client)

The `nextbillion-mcp` server runs locally over stdio via `npx`. Any MCP-capable client can use
it with the snippets below. You need a NextBillion.ai API key from
[console.nextbillion.ai](https://console.nextbillion.ai).

## Claude Code

```bash
claude mcp add nextbillion --env NBAI_API_KEY=YOUR_KEY -- npx -y nextbillion-mcp
```

## Cursor

Add to `~/.cursor/mcp.json` (or `.cursor/mcp.json` in your project):

```json
{
  "mcpServers": {
    "nextbillion": {
      "command": "npx",
      "args": ["-y", "nextbillion-mcp"],
      "env": { "NBAI_API_KEY": "YOUR_KEY" }
    }
  }
}
```

## Codex CLI

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.nextbillion]
command = "npx"
args = ["-y", "nextbillion-mcp"]
env = { "NBAI_API_KEY" = "YOUR_KEY" }
```

## Environment variables

| Variable          | Required | Description                                         |
| ----------------- | -------- | --------------------------------------------------- |
| `NBAI_API_KEY`    | yes      | NextBillion.ai API key                              |
| `NBAI_BASE_URL`   | no       | API base URL (default `https://api.nextbillion.io`) |
| `NBAI_TIMEOUT_MS` | no       | Per-request timeout in milliseconds (default 30000) |
