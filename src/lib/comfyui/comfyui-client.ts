export interface ComfyUIWorkflow {
  id: string;
  name: string;
  description?: string;
  nodes: Record<string, any>;
  output?: any;
}

export interface ComfyUIExecutionStatus {
  status: 'pending' | 'executing' | 'completed' | 'failed';
  progress?: number;
  message?: string;
  output?: any;
  error?: string;
}

export interface ComfyUINodeInfo {
  id: string;
  type: string;
  title: string;
  description?: string;
  category?: string;
  inputTypes?: Record<string, string>;
  outputTypes?: Record<string, string>;
}

export interface ComfyUISystemInfo {
  version: string;
  pythonVersion: string;
  torchVersion: string;
  availableModels: string[];
  availableSamplers: string[];
  availableUpscalers: string[];
  customNodes: string[];
  gpuInfo?: {
    name: string;
    memory: string;
    cudaVersion: string;
  };
}

export class ComfyUIClient {
  private baseUrl: string;
  private apiKey?: string;
  private defaultTimeout: number;

  constructor(config: {
    baseUrl?: string;
    apiKey?: string;
    defaultTimeout?: number;
  } = {}) {
    this.baseUrl = config.baseUrl || 'http://localhost:8188';
    this.apiKey = config.apiKey;
    this.defaultTimeout = config.defaultTimeout || 300000; // 5 minutes default
  }

  /**
   * Check if ComfyUI service is running and accessible
   */
  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/system_stats`, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000)
      });
      return response.ok;
    } catch (error) {
      console.error('ComfyUI health check failed:', error);
      return false;
    }
  }

  /**
   * Get system information and available resources
   */
  async getSystemInfo(): Promise<ComfyUISystemInfo> {
    const response = await fetch(`${this.baseUrl}/system_stats`, {
      method: 'GET',
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      throw new Error(`Failed to get system info: ${response.statusText}`);
    }

    const data = await response.json();
    return this.parseSystemInfo(data);
  }

  /**
   * Get list of available custom nodes
   */
  async getCustomNodes(): Promise<ComfyUINodeInfo[]> {
    const response = await fetch(`${this.baseUrl}/object_info`, {
      method: 'GET',
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      throw new Error(`Failed to get custom nodes: ${response.statusText}`);
    }

    const data = await response.json();
    return this.parseCustomNodes(data);
  }



  /**
   * Execute a custom workflow
   */
  async executeWorkflow(workflow: ComfyUIWorkflow): Promise<string> {
    // Queue the workflow
    const queueResponse = await fetch(`${this.baseUrl}/prompt`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        prompt: workflow.nodes,
        client_id: `comfyui-tool-${Date.now()}`
      }),
      signal: AbortSignal.timeout(10000)
    });

    if (!queueResponse.ok) {
      throw new Error(`Failed to queue workflow: ${queueResponse.statusText}`);
    }

    const queueData = await queueResponse.json();
    const promptId = queueData.prompt_id;

    // Wait for execution to complete
    return this.waitForExecution(promptId);
  }

  /**
   * Queue a prompt with extra data (new queue mode)
   * This method submits a prompt to ComfyUI and returns the prompt_id immediately
   * without waiting for completion
   */
  async queuePrompt(options: {
    prompt: Record<string, any>;
    extra_data?: {
      inputs?: Record<string, any>;
      [key: string]: any;
    };
    client_id?: string;
  }): Promise<{ prompt_id: string; number: number }> {
    const queueResponse = await fetch(`${this.baseUrl}/prompt`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        prompt: options.prompt,
        extra_data: options.extra_data,
        client_id: options.client_id || `comfyui-tool-${Date.now()}`
      }),
      signal: AbortSignal.timeout(10000)
    });

    if (!queueResponse.ok) {
      const errorText = await queueResponse.text();
      throw new Error(`Failed to queue prompt: ${queueResponse.statusText} - ${errorText}`);
    }

    const queueData = await queueResponse.json();
    return {
      prompt_id: queueData.prompt_id,
      number: queueData.number
    };
  }

  /**
   * Get the status of a queued prompt by prompt_id
   * Returns the current execution status without waiting
   */
  async getPromptStatus(promptId: string): Promise<{
    status: 'pending' | 'executing' | 'completed' | 'failed';
    progress?: number;
    output?: any;
    error?: string;
  }> {
    return this.getExecutionStatus(promptId);
  }

  /**
   * Wait for a prompt to complete execution
   * Similar to waitForExecution but returns full execution data
   */
  async waitForPromptCompletion(promptId: string, timeout?: number): Promise<{
    status: 'completed' | 'failed';
    output?: any;
    error?: string;
    images?: Array<{ filename: string; subfolder: string; type: string }>;
  }> {
    const maxTimeout = timeout || this.defaultTimeout;
    const startTime = Date.now();

    while (Date.now() - startTime < maxTimeout) {
      const status = await this.getExecutionStatus(promptId);

      if (status.status === 'completed') {
        return {
          status: 'completed',
          output: status.output,
          images: status.output?.images
        };
      }

      if (status.status === 'failed') {
        return {
          status: 'failed',
          error: status.error
        };
      }

      // Wait before checking again
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    throw new Error('Prompt execution timed out');
  }

  /**
   * Get execution status and wait for completion
   */
  private async waitForExecution(promptId: string): Promise<string> {
    const startTime = Date.now();

    while (Date.now() - startTime < this.defaultTimeout) {
      const status = await this.getExecutionStatus(promptId);

      if (status.status === 'completed') {
        return status.output?.images?.[0]?.filename || 'Generated image completed';
      }

      if (status.status === 'failed') {
        throw new Error(`Workflow execution failed: ${status.error}`);
      }

      // Wait before checking again
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    throw new Error('Workflow execution timed out');
  }

  /**
   * Get execution status for a prompt
   */
  private async getExecutionStatus(promptId: string): Promise<ComfyUIExecutionStatus> {
    const response = await fetch(`${this.baseUrl}/history/${promptId}`, {
      method: 'GET',
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      return { status: 'pending' };
    }

    const data = await response.json();
    return this.parseExecutionStatus(data);
  }



  /**
   * Parse system information from API response
   */
  private parseSystemInfo(data: any): ComfyUISystemInfo {
    return {
      version: data.version || 'unknown',
      pythonVersion: data.python_version || 'unknown',
      torchVersion: data.torch_version || 'unknown',
      availableModels: data.models || [],
      availableSamplers: data.samplers || [],
      availableUpscalers: data.upscalers || [],
      customNodes: data.custom_nodes || [],
      gpuInfo: data.gpu_info
    };
  }

  /**
   * Parse custom nodes information from API response
   */
  private parseCustomNodes(data: any): ComfyUINodeInfo[] {
    const nodes: ComfyUINodeInfo[] = [];

    for (const [nodeType, nodeInfo] of Object.entries(data)) {
      if (typeof nodeInfo === 'object' && nodeInfo !== null) {
        nodes.push({
          id: nodeType,
          type: nodeType,
          title: (nodeInfo as any).title || nodeType,
          description: (nodeInfo as any).description,
          category: (nodeInfo as any).category,
          inputTypes: (nodeInfo as any).input?.required || {},
          outputTypes: (nodeInfo as any).output || {}
        });
      }
    }

    return nodes;
  }

  /**
   * Parse execution status from API response
   */
  private parseExecutionStatus(data: any): ComfyUIExecutionStatus {
    // ComfyUI history endpoint returns: { "prompt_id": { "prompt": [...], "outputs": {...} } }
    // If data is empty or prompt_id not found, execution is still pending/executing
    if (!data || Object.keys(data).length === 0) {
      return {
        status: 'pending',
        progress: 0
      };
    }

    // Get the first (and only) prompt_id from the response
    const promptId = Object.keys(data)[0];
    const promptData = data[promptId];

    if (!promptData) {
      return {
        status: 'pending',
        progress: 0
      };
    }

    // Check for errors
    if (promptData.status?.status_str === 'error' || promptData.error) {
      return {
        status: 'failed',
        error: promptData.error || 'Workflow execution failed'
      };
    }

    // Check if outputs exist (indicates completion)
    if (promptData.outputs) {
      // Find any node output that has images (typically SaveImage node)
      const outputs = promptData.outputs;
      for (const nodeId in outputs) {
        const nodeOutput = outputs[nodeId];
        if (nodeOutput.images && nodeOutput.images.length > 0) {
          return {
            status: 'completed',
            output: {
              images: nodeOutput.images
            }
          };
        }
      }
    }

    // If we have prompt data but no outputs yet, it's still executing
    return {
      status: 'executing',
      progress: 50
    };
  }

  /**
   * Upload an image to ComfyUI
   * Returns the filename and subfolder that can be used in workflows
   */
  async uploadImage(
    imageBuffer: Buffer,
    fileName: string,
    subfolder?: string,
    overwrite?: boolean
  ): Promise<{ name: string; subfolder: string; type: string }> {
    const formData = new FormData();
    // Convert Buffer to Uint8Array for Blob compatibility
    const uint8Array = new Uint8Array(imageBuffer);
    const blob = new Blob([uint8Array], { type: 'image/png' });
    formData.append('image', blob, fileName);

    if (subfolder) {
      formData.append('subfolder', subfolder);
    }
    if (overwrite !== undefined) {
      formData.append('overwrite', overwrite.toString());
    }

    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(`${this.baseUrl}/upload/image`, {
      method: 'POST',
      headers,
      body: formData,
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to upload image: ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    return {
      name: data.name || fileName,
      subfolder: data.subfolder || 'input',
      type: data.type || 'input'
    };
  }

  /**
   * Get headers for API requests
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    return headers;
  }
}
