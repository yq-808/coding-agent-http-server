import type { AgentProvider } from './provider.js';
import { ClaudeProvider } from './claude.js';

const providers: AgentProvider[] = [new ClaudeProvider()];

export const listProviders = (): string[] => providers.map((provider) => provider.id);

export const getProvider = (id: string): AgentProvider | undefined =>
  providers.find((provider) => provider.id === id.toLowerCase());
