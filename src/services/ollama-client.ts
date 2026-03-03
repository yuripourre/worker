import { EXTERNAL_SERVICES_CONFIG } from '../shared';

export interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
  digest: string;
}

export interface OllamaStatus {
  isRunning: boolean;
  baseUrl: string;
  models: OllamaModel[];
  version?: string;
}

export interface OllamaGenerateOptions {
  model: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  repeatPenalty?: number;
  stream?: boolean;
}

export interface OllamaGenerateResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_duration?: number;
  eval_duration?: number;
}

export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | any[]; // Can be string or array for multimodal content
}

export interface OllamaChatOptions {
  model: string;
  messages: OllamaChatMessage[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  repeatPenalty?: number;
  stream?: boolean;
}

export interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_duration?: number;
  eval_duration?: number;
}

export interface OllamaModelInfo {
  modelName: string;
  info: any;
  parameters: number;
  architecture: string;
  quantization: string;
  family: string;
  license: string;
  description: string;
}

export interface OllamaGenerateResult {
  success: boolean;
  modelName: string;
  response: string;
  prompt: string;
  tokensUsed?: number;
  generationTime?: number;
  metadata?: any;
}

export class OllamaClient {
  private baseUrl: string;
  private defaultModel: string;
  private defaultTemperature: number;
  private defaultMaxTokens: number;

  constructor(config: {
    baseUrl?: string;
    defaultModel?: string;
    defaultTemperature?: number;
    defaultMaxTokens?: number;
  } = {}) {
    this.baseUrl = config.baseUrl || EXTERNAL_SERVICES_CONFIG.DEFAULT_OLLAMA_BASE_URL;
    this.defaultModel = config.defaultModel || 'llama2';
    this.defaultTemperature = config.defaultTemperature || 0.7;
    this.defaultMaxTokens = config.defaultMaxTokens || 2048;
  }

  /**
   * Check if Ollama is currently running
   */
  async checkStatus(): Promise<OllamaStatus> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (response.ok) {
        const data = await response.json();
        
        // Get version info
        let version: string | undefined;
        try {
          const versionResponse = await fetch(`${this.baseUrl}/api/version`);
          if (versionResponse.ok) {
            const versionData = await versionResponse.json();
            version = versionData.version;
          }
        } catch (error: any) {
          console.debug('Could not fetch version info', { error: error.message || String(error) });
        }

        return {
          isRunning: true,
          baseUrl: this.baseUrl,
          models: data.models || [],
          version
        };
      }
    } catch (error: any) {
      console.debug('Ollama not responding', { error: error.message || String(error) });
    }

    return {
      isRunning: false,
      baseUrl: this.baseUrl,
      models: []
    };
  }

  /**
   * List all available models
   */
  async listModels(): Promise<OllamaModel[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      return data.models || [];
    } catch (error: any) {
      console.error('Failed to list models:', error);
      throw new Error(`Failed to list models: ${error.message || String(error)}`);
    }
  }

  /**
   * Get information about a specific model
   */
  async getModelInfo(modelName: string): Promise<OllamaModelInfo> {
    try {
      const response = await fetch(`${this.baseUrl}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      return {
        modelName,
        info: data,
        parameters: data.parameter_size || 0,
        architecture: data.architecture || 'unknown',
        quantization: data.quantization_level || 'unknown',
        family: data.family || 'unknown',
        license: data.license || 'unknown',
        description: data.description || 'No description available'
      };
    } catch (error: any) {
      console.error('Failed to get model info:', error);
      throw new Error(`Failed to get model info: ${error.message || String(error)}`);
    }
  }

  /**
   * Pull a model from Ollama Hub
   * Ollama returns a streaming response (newline-delimited JSON)
   */
  async pullModel(modelName: string): Promise<{ success: boolean; message: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('Response body is null');
      }

      // Read the streaming response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let lastStatus: any = null;
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) {
            break;
          }

          // Decode the chunk and add to buffer
          buffer += decoder.decode(value, { stream: true });

          // Process complete lines (newline-delimited JSON)
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer

          for (const line of lines) {
            if (line.trim()) {
              try {
                const data = JSON.parse(line);
                lastStatus = data;
                
                // Log progress if available
                if (data.status) {
                  console.log(`📥 Pulling ${modelName}: ${data.status}${data.completed ? ` (${data.completed}/${data.total})` : ''}`);
                }
              } catch (parseError) {
                // Skip invalid JSON lines
                console.warn('Failed to parse JSON line:', line);
              }
            }
          }
        }

        // Process any remaining buffer
        if (buffer.trim()) {
          try {
            const data = JSON.parse(buffer);
            lastStatus = data;
          } catch (parseError) {
            // Ignore parse errors for incomplete final line
          }
        }
      } finally {
        reader.releaseLock();
      }

      // Check if the pull was successful
      if (lastStatus && lastStatus.status === 'success') {
        return {
          success: true,
          message: `Model ${modelName} pulled successfully`
        };
      } else if (lastStatus && lastStatus.error) {
        throw new Error(lastStatus.error);
      } else {
        // If we got here without an error status, assume success
        return {
          success: true,
          message: `Model ${modelName} pulled successfully`
        };
      }
    } catch (error: any) {
      console.error('Failed to pull model:', error);
      throw new Error(`Failed to pull model: ${error.message || String(error)}`);
    }
  }

  /**
   * Remove a model
   */
  async removeModel(modelName: string): Promise<{ success: boolean; message: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/api/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return {
        success: true,
        message: `Model ${modelName} removed successfully`
      };
    } catch (error: any) {
      console.error('Failed to remove model:', error);
      throw new Error(`Failed to remove model: ${error.message || String(error)}`);
    }
  }

  /**
   * Generate text using the generate API (legacy method)
   */
  async generateText(options: OllamaGenerateOptions): Promise<string> {
    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: options.model,
          prompt: options.prompt,
          stream: options.stream || false,
          options: {
            temperature: options.temperature || this.defaultTemperature,
            top_p: options.topP || 0.9,
            top_k: options.topK || 40,
            repeat_penalty: options.repeatPenalty || 1.1,
            num_predict: options.maxTokens || this.defaultMaxTokens,
          }
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: OllamaGenerateResponse = await response.json();
      return data.response;
    } catch (error: any) {
      console.error('Failed to generate text:', error);
      throw new Error(`Failed to generate text: ${error.message || String(error)}`);
    }
  }

  /**
   * Generate text using the chat API (recommended method)
   */
  async chat(options: OllamaChatOptions): Promise<string> {
    try {
      // First check if Ollama is running and accessible
      const status = await this.checkStatus();
      if (!status.isRunning) {
        throw new Error(`Ollama server is not running or not accessible at ${this.baseUrl}. Please ensure Ollama is running and accessible.`);
      }

      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: options.model,
          messages: options.messages,
          stream: options.stream || false,
          options: {
            temperature: options.temperature || this.defaultTemperature,
            top_p: options.topP || 0.9,
            top_k: options.topK || 40,
            repeat_penalty: options.repeatPenalty || 1.1,
            num_predict: options.maxTokens || this.defaultMaxTokens,
          }
        })
      });

      if (!response.ok) {
        let errorDetails = `HTTP ${response.status}: ${response.statusText}`;
        
        // Try to get more details from the response
        try {
          const errorData = await response.json();
          if (errorData.error) {
            errorDetails = errorData.error;
          }
        } catch {
          // If we can't parse the error, use the status text
        }

        // Provide specific guidance for common errors
        if (response.status === 404) {
          throw new Error(`Ollama API endpoint not found at ${this.baseUrl}/api/chat. This may indicate: (1) Ollama server is not running, (2) Ollama version doesn't support /api/chat endpoint, or (3) Incorrect base URL. Error: ${errorDetails}`);
        } else if (response.status === 400) {
          throw new Error(`Invalid request to Ollama at ${this.baseUrl}. Model "${options.model}" may not exist or request format is invalid. Error: ${errorDetails}`);
        } else {
          throw new Error(`Ollama request failed (${response.status}) at ${this.baseUrl}: ${errorDetails}`);
        }
      }

      const data: OllamaChatResponse = await response.json();
      return data.message.content;
    } catch (error: any) {
      // If it's already our improved error message, re-throw it
      if (error.message && (
        error.message.includes('Ollama server is not running') ||
        error.message.includes('Ollama API endpoint not found') ||
        error.message.includes('Invalid request to Ollama') ||
        error.message.includes('Ollama request failed')
      )) {
        throw error;
      }
      
      // Otherwise, enhance the error message with context
      console.error('Failed to chat:', error);
      const baseMessage = error.message || String(error);
      
      // Check if it's a network error
      if (error.message?.includes('fetch failed') || error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        throw new Error(`Cannot connect to Ollama server at ${this.baseUrl}. Please ensure Ollama is running and the URL is correct. Original error: ${baseMessage}`);
      }
      
      throw new Error(`Failed to chat with Ollama at ${this.baseUrl}: ${baseMessage}`);
    }
  }

  /**
   * Legacy invoke method for backward compatibility
   * Converts simple prompts to chat format
   */
  async invoke(prompt: string, options?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<{ content: string }> {
    try {
      const model = options?.model || this.defaultModel;
      const temperature = options?.temperature || this.defaultTemperature;
      const maxTokens = options?.maxTokens || this.defaultMaxTokens;

      const response = await this.chat({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature,
        maxTokens
      });

      return { content: response };
    } catch (error: any) {
      console.error('Ollama invoke failed:', error);
      return { 
        content: `Error: Unable to connect to Ollama at ${this.baseUrl}. Please ensure Ollama is running and accessible. Original error: ${error.message || String(error)}` 
      };
    }
  }

  /**
   * Generate a response with comprehensive metadata
   */
  async generateResponse(
    modelName: string,
    prompt: string,
    options?: {
      temperature?: number;
      maxTokens?: number;
      baseUrl?: string;
    }
  ): Promise<OllamaGenerateResult> {
    try {
      const startTime = Date.now();
      const temperature = options?.temperature || this.defaultTemperature;
      const maxTokens = options?.maxTokens || this.defaultMaxTokens;
      
      const response = await this.generateText({
        model: modelName,
        prompt,
        temperature,
        maxTokens
      });

      const generationTime = Date.now() - startTime;
      
      return {
        success: true,
        modelName,
        response,
        prompt,
        generationTime,
        metadata: {
          model: modelName,
          temperature,
          maxTokens,
          timestamp: new Date().toISOString(),
          baseUrl: options?.baseUrl || this.baseUrl
        }
      };
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to generate response: ${errorMessage}`);
    }
  }

  /**
   * Simulate response generation for testing purposes
   */
  async generateSimulatedResponse(
    modelName: string,
    prompt: string,
    options?: {
      temperature?: number;
      maxTokens?: number;
      successRate?: number;
    }
  ): Promise<OllamaGenerateResult> {
    const successRate = options?.successRate || 0.95;
    const success = Math.random() > (1 - successRate);
    
    if (success) {
      const response = `This is a simulated response from ${modelName} to the prompt: "${prompt}". The model processed this request with temperature ${options?.temperature || this.defaultTemperature} and generated up to ${options?.maxTokens || this.defaultMaxTokens} tokens.`;
      const generationTime = Math.random() * 5000 + 1000; // 1-6 seconds

      return {
        success: true,
        modelName,
        response,
        prompt,
        generationTime,
        metadata: {
          model: modelName,
          temperature: options?.temperature || this.defaultTemperature,
          maxTokens: options?.maxTokens || this.defaultMaxTokens,
          timestamp: new Date().toISOString(),
          simulated: true
        }
      };
    } else {
      throw new Error('Model generation failed (simulated)');
    }
  }

  /**
   * Get the current base URL
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Set a new base URL
   */
  setBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl;
  }

  /**
   * Get current configuration
   */
  getConfig(): {
    baseUrl: string;
    defaultModel: string;
    defaultTemperature: number;
    defaultMaxTokens: number;
  } {
    return {
      baseUrl: this.baseUrl,
      defaultModel: this.defaultModel,
      defaultTemperature: this.defaultTemperature,
      defaultMaxTokens: this.defaultMaxTokens
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<{
    baseUrl: string;
    defaultModel: string;
    defaultTemperature: number;
    defaultMaxTokens: number;
  }>): void {
    if (config.baseUrl !== undefined) this.baseUrl = config.baseUrl;
    if (config.defaultModel !== undefined) this.defaultModel = config.defaultModel;
    if (config.defaultTemperature !== undefined) this.defaultTemperature = config.defaultTemperature;
    if (config.defaultMaxTokens !== undefined) this.defaultMaxTokens = config.defaultMaxTokens;
  }
}
