import type { McpTool } from '../shared';

export interface LLMDebugInfo {
  systemPrompt?: string;
  userPrompt: string;
  toolCalls?: Array<{
    name: string;
    args: Record<string, any>;
    result?: string;
  }>;
  availableTools?: Array<{
    name: string;
    description?: string;
    serverId: string;
    _executeUrl: string;
  }>;
  messages?: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | any;
  }>;
  model: string;
  temperature: number;
}

export interface LLMChatResponse {
  content: string;
  debugInfo?: LLMDebugInfo;
}

export interface LLMChatOptions {
  model: string;
  temperature: number;
  prompt: string;
  systemPrompt?: string;
  tools?: McpTool[];
  image?: {
    fileName: string;
    mimeType: string;
    data: string; // Base64 encoded image data
  };
  numCtx?: number;
  numPredict?: number;
  think?: boolean | 'low' | 'medium' | 'high';
  topP?: number;
  topK?: number;
  repeatPenalty?: number;
  seed?: number;
  /** Ollama structured output. Pass "json" to force valid JSON, or a JSON Schema object to enforce its shape. */
  format?: 'json' | Record<string, unknown>;
}

export interface LLMClient {
  chat(options: LLMChatOptions): Promise<LLMChatResponse>;
}

export interface LLMConfig {
  baseUrl?: string;
  defaultModel?: string;
  defaultTemperature?: number;
  defaultMaxTokens?: number;
}
