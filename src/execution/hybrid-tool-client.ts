import type { ToolContext } from '../types';

const MCP_TOOLS_PATH = '/api/mcp/tools';

export interface McpToolInfo {
  name: string;
  description: string;
  schema: Record<string, unknown>;
}

/**
 * Client for the MCP (Model Context Protocol) tools API.
 */
export class McpClient {
  private baseUrl: string;
  private deviceId?: string;
  private workerId?: string;

  constructor(baseUrl: string, deviceId?: string, workerId?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.deviceId = deviceId;
    this.workerId = workerId;
  }

  setDeviceId(id: string): void {
    this.deviceId = id;
  }

  setWorkerId(id: string): void {
    this.workerId = id;
  }

  private getHeaders(permissions?: string[]): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (this.deviceId) headers['X-MCP-Device-ID'] = this.deviceId;
    if (this.workerId) headers['X-MCP-Worker-ID'] = this.workerId;
    if (permissions && permissions.length > 0) {
      headers['X-MCP-Permissions'] = permissions.join(',');
    }
    return headers;
  }

  async listTools(): Promise<McpToolInfo[]> {
    try {
      const response = await fetch(`${this.baseUrl}${MCP_TOOLS_PATH}`, {
        method: 'GET',
        headers: this.getHeaders()
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = (await response.json()) as { tools?: McpToolInfo[] };
      return data.tools ?? [];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`MCP client error: ${message}`);
    }
  }

  async getTool(name: string): Promise<McpToolInfo> {
    try {
      const response = await fetch(`${this.baseUrl}${MCP_TOOLS_PATH}/${encodeURIComponent(name)}`, {
        method: 'GET',
        headers: this.getHeaders()
      });
      if (response.status === 404) {
        throw new Error('MCP client error: Failed to get tool details: Not Found');
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return (await response.json()) as McpToolInfo;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('MCP client error:')) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`MCP client error: ${message}`);
    }
  }

  async invokeTool(name: string, params: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    try {
      const response = await fetch(`${this.baseUrl}${MCP_TOOLS_PATH}/${encodeURIComponent(name)}/execute`, {
        method: 'POST',
        headers: this.getHeaders(context.permissions),
        body: JSON.stringify(params)
      });
      const data = (await response.json()) as { result?: unknown; error?: string; message?: string };
      if (!response.ok) {
        const msg = data.error ?? data.message ?? response.statusText;
        throw new Error(`MCP client error: Tool execution failed: ${msg}`);
      }
      return data.result;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('MCP client error:')) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`MCP client error: ${message}`);
    }
  }
}

/**
 * Hybrid tool client (remote + local). Stub for backward compatibility.
 */
export class HybridToolClient {
  constructor(_config: unknown) {}
}
