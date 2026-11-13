/**
 * Domain-verification tokens served verbatim as text/plain at `/.well-known/<name>`.
 *
 * A directory (plugin store) proves we control the MCP host by fetching a token it generated
 * from a fixed well-known URL. The tokens are public by design (anyone can fetch the URL), so
 * they live in source: changing one is a normal release. An empty value means the route is
 * not served (404), like any unknown path.
 */
export const VERIFICATION_TOKENS: Readonly<Record<string, string>> = {
  // OpenAI plugin directory (ChatGPT / Codex): "Verify Domain" in the submission portal.
  'openai-apps-challenge': 'rOvSJtXzU1yZ04aiR9W0JZZAnWi_k3VfdAQTI23TyVQ',
};
