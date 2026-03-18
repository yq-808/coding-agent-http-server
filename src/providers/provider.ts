import type { JsonRecord } from '../utils.js';

export type ProviderRunRequest = {
  prompt: string;
  options: JsonRecord;
  abortController: AbortController;
  onStderr: (data: string) => void;
};

export interface AgentProvider {
  id: string;
  assertAvailable(): void;
  run(request: ProviderRunRequest): AsyncGenerator<unknown, void>;
}
