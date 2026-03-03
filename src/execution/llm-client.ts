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
    description: string;
    endpoint: string;
    method: string;
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

/** Ollama-style options for LLM chat (think, context window, sampling) */
export interface LLMChatOptions {
  model: string;
  temperature: number;
  prompt: string;
  systemPrompt?: string;
  toolsUrl?: string;
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
