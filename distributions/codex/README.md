# Codex plugin bundle

Plugin bundle for the Codex CLI plugin system (v0.117.0+), wrapping the `nextbillion-mcp`
stdio server. Structure follows the Codex plugin layout: `.codex-plugin/plugin.json` manifest +
`.mcp.json` MCP server declaration.

Status: the official OpenAI Plugin Directory does not support self-serve publishing yet — this
bundle is prepared for a curation submission. Until it is listed, Codex users configure the
server manually (see `../manual/README.md`) or install from a repository/personal marketplace.

Note: Codex uses the plugin version as part of its cache key. Bump `version` here on every
release — CI verifies it matches the npm package version.
