import { spawnSync } from 'node:child_process';
import path from 'node:path';
import {
  query,
  type CanUseTool,
  type Options,
  type PermissionMode,
  type PermissionResult,
} from '@anthropic-ai/claude-agent-sdk';
import type { AgentProvider, ProviderRunRequest } from './provider.js';
import {
  coerceEnv,
  expandHomePath,
  isPathInsideDirectory,
  parseCsv,
  parsePositiveInt,
} from '../utils.js';

const VALID_PERMISSION_MODES = new Set<PermissionMode>([
  'default',
  'acceptEdits',
  'bypassPermissions',
  'plan',
  'dontAsk',
]);

const WRITE_TOOL_PATH_FIELDS: Record<string, string> = {
  Edit: 'file_path',
  MultiEdit: 'file_path',
  Write: 'file_path',
  NotebookEdit: 'notebook_path',
};

const createWorkspaceWriteGuard = (workspaceCwd: string, writableRoots: string[]): CanUseTool => {
  const normalizedWorkspaceCwd = path.resolve(workspaceCwd);

  return async (toolName, input, meta): Promise<PermissionResult> => {
    const pathField = WRITE_TOOL_PATH_FIELDS[toolName];
    if (!pathField) {
      return { behavior: 'allow', toolUseID: meta.toolUseID };
    }

    if (writableRoots.length === 0) {
      return {
        behavior: 'deny',
        message: 'This session is read-only. Provide options.cwd to enable writes in that workspace.',
        toolUseID: meta.toolUseID,
      };
    }

    const rawPath = input[pathField];
    if (typeof rawPath !== 'string' || !rawPath.trim()) {
      return {
        behavior: 'deny',
        message: `Missing required path field '${pathField}' for tool ${toolName}.`,
        toolUseID: meta.toolUseID,
      };
    }

    const expandedPath = expandHomePath(rawPath);
    const normalizedTargetPath = path.resolve(normalizedWorkspaceCwd, expandedPath);
    const writable = writableRoots.some((root) => isPathInsideDirectory(normalizedTargetPath, root));
    if (!writable) {
      return {
        behavior: 'deny',
        message: `Write access is restricted to: ${writableRoots.join(', ')}`,
        toolUseID: meta.toolUseID,
      };
    }

    return { behavior: 'allow', toolUseID: meta.toolUseID };
  };
};

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
    const defaultModel = process.env.AGENT_DEFAULT_MODEL?.trim();
    const defaultMaxThinkingTokens = parsePositiveInt(process.env.AGENT_MAX_THINKING_TOKENS);
    const defaultAllowedTools = parseCsv(process.env.AGENT_DEFAULT_ALLOWED_TOOLS);
    const defaultToolsPreset = process.env.AGENT_DEFAULT_TOOLS_PRESET?.trim() || 'claude_code';
    const defaultPermissionModeEnv = process.env.AGENT_DEFAULT_PERMISSION_MODE?.trim();
    const defaultPermissionMode: PermissionMode =
      defaultPermissionModeEnv && VALID_PERMISSION_MODES.has(defaultPermissionModeEnv as PermissionMode)
        ? (defaultPermissionModeEnv as PermissionMode)
        : 'bypassPermissions';
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

    if (!('permissionMode' in requestOptions)) {
      options.permissionMode = defaultPermissionMode;
    }

    if (
      options.permissionMode === 'bypassPermissions' &&
      !('allowDangerouslySkipPermissions' in requestOptions)
    ) {
      options.allowDangerouslySkipPermissions = true;
    }

    if (typeof options.cwd === 'string' && options.cwd.trim()) {
      const writableRoots = request.writableRoots.map((root) => path.resolve(expandHomePath(root)));

      const workspaceWriteGuard = createWorkspaceWriteGuard(options.cwd, writableRoots);
      const upstreamCanUseTool =
        typeof requestOptions.canUseTool === 'function' ? requestOptions.canUseTool : undefined;

      options.canUseTool = async (toolName, input, meta): Promise<PermissionResult> => {
        const guardResult = await workspaceWriteGuard(toolName, input, meta);
        if (guardResult.behavior === 'deny') {
          return guardResult;
        }

        if (upstreamCanUseTool) {
          return upstreamCanUseTool(toolName, input, meta);
        }

        return { behavior: 'allow', toolUseID: meta.toolUseID };
      };
    }

    return query({ prompt: request.prompt, options });
  }
}
