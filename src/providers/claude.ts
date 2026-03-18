import { spawnSync } from 'node:child_process';
import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import type { AgentProvider, ProviderRunRequest } from './provider.js';
import { coerceEnv, parseCsv, parsePositiveInt } from '../utils.js';

const buildBaseEnv = (): Record<string, string | undefined> => {
  const entries = Object.entries(process.env).filter(
    ([key, value]) => key !== 'CLAUDECODE' && typeof value === 'string',
  ) as Array<[string, string]>;

  return Object.fromEntries(entries);
};

export class ClaudeProvider implements AgentProvider {
  id = 'claude';
  private checked = false;

  assertAvailable(): void {
    if (this.checked || process.env.SKIP_PROVIDER_CHECK === '1') return;

    const result = spawnSync('claude', ['--version'], { stdio: 'ignore' });
    if (result.error) {
      throw new Error(
        'Claude CLI not found. Install it and ensure `claude` is available on PATH.',
      );
    }

    if (typeof result.status === 'number' && result.status !== 0) {
      throw new Error('Claude CLI returned non-zero exit code. Check provider setup first.');
    }

    this.checked = true;
  }

  run(request: ProviderRunRequest): AsyncGenerator<unknown, void> {
    this.assertAvailable();

    const requestOptions = request.options as Partial<Options>;
    const defaultCwd = process.env.AGENT_DEFAULT_CWD?.trim() || process.cwd();
    const defaultModel = process.env.AGENT_DEFAULT_MODEL?.trim() || undefined;
    const defaultMaxThinkingTokens = parsePositiveInt(process.env.AGENT_MAX_THINKING_TOKENS);
    const defaultAllowedTools = parseCsv(process.env.AGENT_DEFAULT_ALLOWED_TOOLS);
    const defaultToolsPreset = process.env.AGENT_DEFAULT_TOOLS_PRESET?.trim() || 'claude_code';
    const validSettingSources = new Set(['user', 'project', 'local']);
    const defaultSettingSources =
      parseCsv(process.env.AGENT_DEFAULT_SETTING_SOURCES)
        ?.map((source) => source.toLowerCase())
        .filter((source) => validSettingSources.has(source)) ?? ['user'];

    const options: Options = {
      ...requestOptions,
      abortController: request.abortController,
      cwd: typeof requestOptions.cwd === 'string' ? requestOptions.cwd : defaultCwd,
      env: {
        ...buildBaseEnv(),
        ...coerceEnv(requestOptions.env),
      },
      stderr: request.onStderr,
    };

    if (!('tools' in requestOptions) && defaultToolsPreset === 'claude_code') {
      options.tools = { type: 'preset', preset: 'claude_code' };
    }

    if (!('allowedTools' in requestOptions) && defaultAllowedTools) {
      options.allowedTools = defaultAllowedTools;
    }

    if (!('model' in requestOptions) && defaultModel) {
      options.model = defaultModel;
    }

    if (!('maxThinkingTokens' in requestOptions) && defaultMaxThinkingTokens) {
      options.maxThinkingTokens = defaultMaxThinkingTokens;
    }

    if (!('settingSources' in requestOptions) && defaultSettingSources.length > 0) {
      options.settingSources = defaultSettingSources as Array<'user' | 'project' | 'local'>;
    }

    return query({ prompt: request.prompt, options });
  }
}
