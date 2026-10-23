import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  it('reads the API key and defaults', () => {
    const config = loadConfig({ NBAI_API_KEY: ' key-123 ' });
    expect(config.apiKey).toBe('key-123');
    expect(config.baseUrl).toBe('https://api.nextbillion.io');
    expect(config.timeoutMs).toBe(30_000);
  });

  it('fails clearly when the key is missing', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({ NBAI_API_KEY: '  ' })).toThrow(/NBAI_API_KEY is not set/);
  });

  it('rejects an unexpanded plugin user_config placeholder as the key', () => {
    // A host that does not substitute `${user_config.*}` passes the template through.
    expect(() => loadConfig({ NBAI_API_KEY: '${user_config.nbai_api_key}' })).toThrow(
      /unexpanded placeholder \$\{user_config\.nbai_api_key\}/,
    );
    expect(() => loadConfig({ NBAI_API_KEY: '${NBAI_API_KEY}' })).toThrow(ConfigError);
  });
});
