import { McpClient } from '../execution/hybrid-tool-client';
import { ToolContext } from '../types';
import fetchMock from 'jest-fetch-mock';

// Enable fetch mocking
fetchMock.enableMocks();

describe('MCP Client', () => {
  beforeEach(() => {
    fetchMock.resetMocks();
  });
  
  describe('Constructor', () => {
    it('should create an instance with baseUrl', () => {
      const client = new McpClient('http://localhost:51111');
      
      expect(client).toBeDefined();
    });
    
    it('should create an instance with baseUrl, deviceId, and workerId', () => {
      const client = new McpClient('http://localhost:51111', 'device-123', 'worker-456');
      
      expect(client).toBeDefined();
    });
  });
  
  describe('Device and Worker ID', () => {
    it('should set deviceId after creation', () => {
      const client = new McpClient('http://localhost:51111');
      client.setDeviceId('device-123');
      
      // We'll test this by checking if the ID is sent in requests
      fetchMock.mockResponseOnce(JSON.stringify({ tools: [] }));
      
      return client.listTools().then(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
        const headers = init?.headers as Record<string, string> | undefined;
        expect(headers).toBeDefined();
        expect(headers!['X-MCP-Device-ID']).toBe('device-123');
      });
    });
    
    it('should set workerId after creation', () => {
      const client = new McpClient('http://localhost:51111');
      client.setWorkerId('worker-456');
      
      // We'll test this by checking if the ID is sent in requests
      fetchMock.mockResponseOnce(JSON.stringify({ tools: [] }));
      
      return client.listTools().then(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
        const headers = init?.headers as Record<string, string> | undefined;
        expect(headers).toBeDefined();
        expect(headers!['X-MCP-Worker-ID']).toBe('worker-456');
      });
    });
  });
  
  describe('Tool Discovery', () => {
    it('should list available tools', async () => {
      const client = new McpClient('http://localhost:51111');
      
      const mockTools = [
        {
          name: 'tool1',
          description: 'Tool 1 description',
          schema: { type: 'object', properties: {} }
        },
        {
          name: 'tool2',
          description: 'Tool 2 description',
          schema: { type: 'object', properties: {} }
        }
      ];
      
      fetchMock.mockResponseOnce(JSON.stringify({ tools: mockTools }));
      
      const tools = await client.listTools();
      
      expect(tools).toBeDefined();
      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe('tool1');
      expect(tools[1].name).toBe('tool2');
      
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:51111/api/mcp/tools',
        expect.objectContaining({
          headers: expect.any(Object)
        })
      );
    });
    
    it('should handle errors when listing tools', async () => {
      const client = new McpClient('http://localhost:51111');
      
      fetchMock.mockRejectOnce(new Error('Network error'));
      
      await expect(client.listTools()).rejects.toThrow('MCP client error: Network error');
      
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    
    it('should get details of a specific tool', async () => {
      const client = new McpClient('http://localhost:51111');
      
      const mockTool = {
        name: 'tool1',
        description: 'Tool 1 description',
        schema: { type: 'object', properties: {} }
      };
      
      fetchMock.mockResponseOnce(JSON.stringify(mockTool));
      
      const tool = await client.getTool('tool1');
      
      expect(tool).toBeDefined();
      expect(tool.name).toBe('tool1');
      expect(tool.description).toBe('Tool 1 description');
      
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:51111/api/mcp/tools/tool1',
        expect.objectContaining({
          headers: expect.any(Object)
        })
      );
    });
    
    it('should handle errors when getting tool details', async () => {
      const client = new McpClient('http://localhost:51111');
      
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'Tool not found' }), { status: 404 });
      
      await expect(client.getTool('non-existent')).rejects.toThrow('MCP client error: Failed to get tool details: Not Found');
      
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
  
  describe('Tool Execution', () => {
    it('should invoke a tool successfully', async () => {
      const client = new McpClient('http://localhost:51111');
      
      const mockResult = { result: 'Tool execution result' };
      fetchMock.mockResponseOnce(JSON.stringify(mockResult));
      
      const context: ToolContext = { permissions: ['read', 'write'] };
      const params = { param1: 'value1', param2: 123 };
      
      const result = await client.invokeTool('test-tool', params, context);
      
      expect(result).toBeDefined();
      expect(result).toBe('Tool execution result');
      
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:51111/api/mcp/tools/test-tool/execute',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-MCP-Permissions': 'read,write'
          }),
          body: JSON.stringify(params)
        })
      );
    });
    
    it('should include authentication headers when invoking a tool', async () => {
      const client = new McpClient('http://localhost:51111', 'device-123', 'worker-456');
      
      const mockResult = { result: 'Tool execution result' };
      fetchMock.mockResponseOnce(JSON.stringify(mockResult));
      
      const context: ToolContext = { permissions: ['read'] };
      const params = { param1: 'value1' };
      
      await client.invokeTool('test-tool', params, context);
      
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
      const requestHeaders = init?.headers as Record<string, string> | undefined;
      expect(requestHeaders).toBeDefined();
      expect(requestHeaders!['X-MCP-Device-ID']).toBe('device-123');
      expect(requestHeaders!['X-MCP-Worker-ID']).toBe('worker-456');
      expect(requestHeaders!['X-MCP-Permissions']).toBe('read');
    });
    
    it('should handle tool execution errors', async () => {
      const client = new McpClient('http://localhost:51111');
      
      fetchMock.mockResponseOnce(
        JSON.stringify({ error: 'Tool execution failed', message: 'Invalid parameters' }), 
        { status: 400 }
      );
      
      const context: ToolContext = { permissions: [] };
      const params = { param1: 'value1' };
      
      await expect(client.invokeTool('test-tool', params, context))
        .rejects.toThrow('MCP client error: Tool execution failed: Tool execution failed');
      
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    
    it('should handle network errors during tool execution', async () => {
      const client = new McpClient('http://localhost:51111');
      
      fetchMock.mockRejectOnce(new Error('Network error'));
      
      const context: ToolContext = { permissions: [] };
      const params = { param1: 'value1' };
      
      await expect(client.invokeTool('test-tool', params, context))
        .rejects.toThrow('MCP client error: Network error');
      
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
