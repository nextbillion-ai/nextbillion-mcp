# Cursor distribution

Cursor has no plugin bundle format; users add the server to `mcp.json` (see
`../manual/README.md` for the snippet).

For the docs site, an "Add to Cursor" one-click deeplink can be generated with a
base64-encoded server config:

```
cursor://anysphere.cursor-deeplink/mcp/install?name=nextbillion&config=<base64 of the JSON below>
```

```json
{
  "command": "npx",
  "args": ["-y", "nextbillion-mcp"],
  "env": { "NBAI_API_KEY": "YOUR_KEY" }
}
```

The docs-site button should prompt the developer for their API key and substitute it into the
config before encoding, so the deeplink carries their key rather than a placeholder.
