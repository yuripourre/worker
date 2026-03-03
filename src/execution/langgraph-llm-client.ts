// Note: options.think is accepted in LLMChatOptions but @langchain/ollama ChatOllama
// does not support it yet; when the library adds think, pass it here.
import { LLMClient, LLMConfig, LLMChatResponse, LLMDebugInfo, type LLMChatOptions } from './llm-client';
import { ChatOllama } from "@langchain/ollama";
import { HumanMessage, SystemMessage, BaseMessage } from "@langchain/core/messages";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { StateGraph, END, Annotation } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { z } from "zod";
import axios from "axios";
import { ToolDefinition, ToolsDefinitionResponse } from '../shared';

const DEFAULT_MODEL = "qwen3:1.7b";
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_TOKENS = 2048;

function buildChatOllamaConfig(
  base: { model: string; baseUrl: string; temperature: number; numPredict: number },
  options: {
    numCtx?: number;
    numPredict?: number;
    topP?: number;
    topK?: number;
    repeatPenalty?: number;
    seed?: number;
  }
) {
  return {
    ...base,
    ...(options.numCtx !== undefined && { numCtx: options.numCtx }),
    ...(options.numPredict !== undefined && { numPredict: options.numPredict }),
    ...(options.topP !== undefined && { topP: options.topP }),
    ...(options.topK !== undefined && { topK: options.topK }),
    ...(options.repeatPenalty !== undefined && { repeatPenalty: options.repeatPenalty }),
    ...(options.seed !== undefined && { seed: options.seed }),
  };
}

const StateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
  }),
});

function createZodSchema(parameters: ToolDefinition["parameters"]): z.ZodObject<any> {
  const schemaObj: Record<string, z.ZodTypeAny> = {};
  parameters.forEach(param => {
    let field: z.ZodTypeAny;
    if (param.enum) {
      field = z.enum(param.enum as [string, ...string[]]);
    } else if (param.type === 'number') {
      field = z.number();
    } else if (param.type === 'boolean') {
      field = z.boolean();
    } else {
      field = z.string();
    }
    field = field.describe(param.description);
    if (!param.required) {
      field = field.optional();
    }
    schemaObj[param.name] = field;
  });
  return z.object(schemaObj) as z.ZodObject<any>;
}

function createDynamicTool(toolDef: ToolDefinition, baseUrl: string): any {
  // Validate required fields
  if (!toolDef || typeof toolDef !== 'object') {
    throw new Error('Tool definition is not a valid object');
  }
  if (!toolDef.name || typeof toolDef.name !== 'string') {
    throw new Error('Tool definition is missing required field "name"');
  }
  if (!toolDef.endpoint || typeof toolDef.endpoint !== 'string') {
    throw new Error(`Tool definition for "${toolDef.name || 'unknown'}" is missing required field "endpoint"`);
  }
  if (!toolDef.method || typeof toolDef.method !== 'string') {
    throw new Error(`Tool definition for "${toolDef.name}" is missing required field "method"`);
  }
  if (!toolDef.parameters || !Array.isArray(toolDef.parameters)) {
    throw new Error(`Tool definition for "${toolDef.name}" is missing or has invalid "parameters" field`);
  }

  // Capture values at creation time to avoid closure issues
  const toolName = String(toolDef.name);
  // Ensure endpoint is a valid non-empty string
  const rawEndpoint = toolDef.endpoint;
  if (!rawEndpoint || typeof rawEndpoint !== 'string' || rawEndpoint.trim().length === 0) {
    throw new Error(`Tool definition for "${toolName}" has invalid endpoint: must be a non-empty string`);
  }
  const toolEndpoint = String(rawEndpoint).trim();
  const toolMethod = String(toolDef.method).toUpperCase();
  const toolParameters = Array.isArray(toolDef.parameters) ? toolDef.parameters : [];

  // @ts-ignore - Type instantiation is excessively deep (TypeScript limitation with complex generics)
  const schema = createZodSchema(toolParameters);
  // @ts-ignore - Type instantiation is excessively deep (TypeScript limitation with complex generics)
  return new DynamicStructuredTool({
    name: toolDef.name,
    description: toolDef.description,
    schema: schema,
    func: async (input: Record<string, any>) => {
      // Resolve endpoint relative to base URL
      const endpointUrl = toolDef.endpoint.startsWith('http')
        ? toolDef.endpoint
        : `${baseUrl}${toolDef.endpoint}`;
      let response;
      switch (toolDef.method) {
        case "GET":
          response = await axios.get(endpointUrl, { params: input });
          break;
        case "POST":
          response = await axios.post(endpointUrl, input);
          break;
        case "PUT":
          response = await axios.put(endpointUrl, input);
          break;
        case "DELETE":
          response = await axios.delete(endpointUrl, { data: input });
          break;
        default:
          throw new Error(`Unsupported HTTP method: ${toolDef.method}`);
      }
      return JSON.stringify(response.data);
    },
  });
}

export class LangGraphLLMClient implements LLMClient {
  private config: LLMConfig;
  private llm: ChatOllama;

  constructor(config: LLMConfig = {}) {
    this.config = config;
    this.llm = new ChatOllama({
      model: config.defaultModel || DEFAULT_MODEL,
      baseUrl: config.baseUrl || "http://localhost:11434",
      temperature: config.defaultTemperature || DEFAULT_TEMPERATURE,
      numPredict: config.defaultMaxTokens || DEFAULT_MAX_TOKENS,
    });
  }

  async chat(options: LLMChatOptions): Promise<LLMChatResponse> {
    try {
      // Check if tools should be used
      if (options.toolsUrl && options.toolsUrl.length > 0) {
        return await this.chatWithTools({
          model: options.model,
          temperature: options.temperature,
          prompt: options.prompt,
          systemPrompt: options.systemPrompt,
          maxTokens: options.numPredict,
          image: options.image,
          toolsUrl: options.toolsUrl,
          numCtx: options.numCtx,
          numPredict: options.numPredict,
          topP: options.topP,
          topK: options.topK,
          repeatPenalty: options.repeatPenalty,
          seed: options.seed,
        });
      } else {
        return await this.chatWithoutTools(options);
      }
    } catch (error) {
      console.error('LangGraph LLM call failed:', error);
      throw error;
    }
  }

  private async chatWithoutTools(options: {
    model: string;
    temperature: number;
    prompt: string;
    systemPrompt?: string;
    image?: {
      fileName: string;
      mimeType: string;
      data: string;
    };
    numCtx?: number;
    numPredict?: number;
    topP?: number;
    topK?: number;
    repeatPenalty?: number;
    seed?: number;
  }): Promise<LLMChatResponse> {
    const baseUrl = this.config.baseUrl || "http://localhost:11434";
    const model = options.model || this.config.defaultModel || DEFAULT_MODEL;
    const temperature = options.temperature !== undefined ? options.temperature : this.config.defaultTemperature || 0.7;
    const numPredict = options.numPredict ?? this.config.defaultMaxTokens ?? DEFAULT_MAX_TOKENS;
    const llm = new ChatOllama(
      buildChatOllamaConfig(
        {
          model,
          baseUrl,
          temperature,
          numPredict,
        },
        {
          numCtx: options.numCtx,
          numPredict: options.numPredict,
          topP: options.topP,
          topK: options.topK,
          repeatPenalty: options.repeatPenalty,
          seed: options.seed,
        }
      )
    );

    // Build messages
    const messages: BaseMessage[] = [];

    if (options.systemPrompt) {
      messages.push(new SystemMessage(options.systemPrompt));
    }

    // Handle image if present
    if (options.image) {
      const imageDataUri = `data:${options.image.mimeType};base64,${options.image.data}`;
      messages.push(new HumanMessage({
        content: [
          { type: 'text', text: options.prompt },
          { type: 'image_url', image_url: { url: imageDataUri } }
        ] as any
      }));
    } else {
      messages.push(new HumanMessage(options.prompt));
    }

    const response = await llm.invoke(messages);
    const content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

    // Build debug info
    const debugInfo: LLMDebugInfo = {
      systemPrompt: options.systemPrompt,
      userPrompt: options.prompt,
      model: options.model || this.config.defaultModel || DEFAULT_MODEL,
      temperature: options.temperature !== undefined ? options.temperature : this.config.defaultTemperature || 0.7,
      messages: messages.map(msg => {
        if (msg instanceof SystemMessage) {
          return { role: 'system' as const, content: msg.content };
        } else if (msg instanceof HumanMessage) {
          return { role: 'user' as const, content: msg.content };
        } else {
          return { role: 'assistant' as const, content: msg.content };
        }
      }).concat([{ role: 'assistant' as const, content: response.content }])
    };

    return {
      content,
      debugInfo
    };
  }

  private async chatWithTools(options: {
    model: string;
    temperature: number;
    prompt: string;
    systemPrompt?: string;
    maxTokens?: number;
    image?: {
      fileName: string;
      mimeType: string;
      data: string;
    };
    toolsUrl: string;
    numCtx?: number;
    numPredict?: number;
    topP?: number;
    topK?: number;
    repeatPenalty?: number;
    seed?: number;
  }): Promise<LLMChatResponse> {
    // Fetch tool definitions
    const response = await axios.get<ToolsDefinitionResponse>(options.toolsUrl);
    const toolDefs = response.data.tools || [];

    // If no tool definitions are provided, fall back to execution without tools
    if (!toolDefs || toolDefs.length === 0) {
      console.warn(`No tools found at ${options.toolsUrl}, falling back to execution without tools`);
      return await this.chatWithoutTools({
        model: options.model,
        temperature: options.temperature,
        prompt: options.prompt,
        systemPrompt: options.systemPrompt,
        image: options.image,
        numCtx: options.numCtx,
        numPredict: options.numPredict,
        topP: options.topP,
        topK: options.topK,
        repeatPenalty: options.repeatPenalty,
        seed: options.seed,
      });
    }

    const toolsUrlObj = new URL(options.toolsUrl);
    const baseUrl = `${toolsUrlObj.protocol}//${toolsUrlObj.host}`;

    // Create tools with error handling
    const tools: any[] = [];
    const toolErrors: string[] = [];
    for (const def of toolDefs) {
      try {
        const tool = createDynamicTool(def, baseUrl);
        tools.push(tool);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Failed to create tool ${def.name}:`, errorMessage);
        toolErrors.push(`Tool ${def.name}: ${errorMessage}`);
      }
    }

    // If no valid tools could be created, fall back to execution without tools
    if (tools.length === 0) {
      console.warn(`No valid tools could be created. Errors: ${toolErrors.join('; ')}. Falling back to execution without tools`);
      return await this.chatWithoutTools({
        model: options.model,
        temperature: options.temperature,
        prompt: options.prompt,
        systemPrompt: options.systemPrompt,
        image: options.image,
        numCtx: options.numCtx,
        numPredict: options.numPredict,
        topP: options.topP,
        topK: options.topK,
        repeatPenalty: options.repeatPenalty,
        seed: options.seed,
      });
    }

    if (toolErrors.length > 0) {
      console.warn(`Some tools failed to load: ${toolErrors.join('; ')}`);
    }

    // Create LLM with tools
    const ollamaBaseUrl = this.config.baseUrl || "http://localhost:11434";
    const model = options.model || this.config.defaultModel || DEFAULT_MODEL;
    const temperature = options.temperature !== undefined ? options.temperature : this.config.defaultTemperature || 0.7;
    const numPredict = options.maxTokens ?? options.numPredict ?? this.config.defaultMaxTokens ?? DEFAULT_MAX_TOKENS;
    const llm = new ChatOllama(
      buildChatOllamaConfig(
        {
          model,
          baseUrl: ollamaBaseUrl,
          temperature,
          numPredict,
        },
        {
          numCtx: options.numCtx,
          numPredict: options.numPredict ?? options.maxTokens,
          topP: options.topP,
          topK: options.topK,
          repeatPenalty: options.repeatPenalty,
          seed: options.seed,
        }
      )
    );

    // Type assertions needed due to TypeScript's limitations with complex generic types in LangChain
    const llmWithTools = llm.bindTools(tools as any);
    const toolNode = new ToolNode(tools as any);

    const callModel = async (state: typeof StateAnnotation.State) => {
      const response = await llmWithTools.invoke(state.messages);
      return { messages: [response] };
    };

    const shouldContinue = (state: typeof StateAnnotation.State) => {
      if (state.messages.length === 0) {
        return END;
      }
      const lastMessage = state.messages[state.messages.length - 1];
      if (!lastMessage) {
        return END;
      }
      return ("tool_calls" in lastMessage &&
              Array.isArray(lastMessage.tool_calls) &&
              lastMessage.tool_calls.length > 0) ? "tools" : END;
    };

    const workflow = new StateGraph(StateAnnotation)
      .addNode("agent", callModel)
      .addNode("tools", toolNode)
      .addEdge("__start__", "agent")
      .addConditionalEdges("agent", shouldContinue, {
        tools: "tools",
        [END]: END,
      })
      .addEdge("tools", "agent");

    const app = workflow.compile();

    // Build messages
    const messages: BaseMessage[] = [];

    if (options.systemPrompt) {
      messages.push(new SystemMessage(options.systemPrompt));
    }

    // Handle image if present
   if (options.image) {
      const imageDataUri = `data:${options.image.mimeType};base64,${options.image.data}`;
      messages.push(new HumanMessage({
        content: [
          { type: 'text', text: options.prompt },
          { type: 'image_url', image_url: { url: imageDataUri } }
        ] as any
      }));
    } else {
      messages.push(new HumanMessage(options.prompt));
    }

    const result = await app.invoke(
      { messages },
      { configurable: { recursionLimit: 100 } }
    );

    // Extract the final response
    const lastMessage = result.messages[result.messages.length - 1];
    const content = typeof lastMessage.content === 'string' ? lastMessage.content : JSON.stringify(lastMessage.content);

    // Extract tool calls from messages
    const toolCalls: LLMDebugInfo['toolCalls'] = [];
    for (const msg of result.messages) {
      if ('tool_calls' in msg && Array.isArray(msg.tool_calls)) {
        for (const toolCall of msg.tool_calls) {
          // Find the corresponding tool result message
          const toolResultMsg = result.messages.find(m =>
            'role' in m && m.role === 'tool' &&
            'tool_call_id' in m && m.tool_call_id === toolCall.id
          );

          toolCalls.push({
            name: toolCall.name || 'unknown',
            args: toolCall.args || {},
            result: toolResultMsg && 'content' in toolResultMsg
              ? (typeof toolResultMsg.content === 'string' ? toolResultMsg.content : JSON.stringify(toolResultMsg.content))
              : undefined
          });
        }
      }
    }

    // Build debug info
    const debugInfo: LLMDebugInfo = {
      systemPrompt: options.systemPrompt,
      userPrompt: options.prompt,
      model: options.model || this.config.defaultModel || DEFAULT_MODEL,
      temperature: options.temperature !== undefined ? options.temperature : this.config.defaultTemperature || 0.7,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      availableTools: toolDefs.map(tool => ({
        name: tool.name,
        description: tool.description || '',
        endpoint: tool.endpoint,
        method: tool.method
      })),
      messages: result.messages.map(msg => {
        if (msg instanceof SystemMessage) {
          return { role: 'system' as const, content: msg.content };
        } else if (msg instanceof HumanMessage) {
          return { role: 'user' as const, content: msg.content };
        } else if ('role' in msg && msg.role === 'tool') {
          return { role: 'tool' as const, content: 'content' in msg ? msg.content : '' };
        } else {
          return { role: 'assistant' as const, content: 'content' in msg ? msg.content : '' };
        }
      })
    };

    return {
      content,
      debugInfo
    };
  }

  getConfig(): LLMConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<LLMConfig>): void {
    this.config = { ...this.config, ...config };
    this.llm = new ChatOllama({
      model: this.config.defaultModel || DEFAULT_MODEL,
      baseUrl: this.config.baseUrl || "http://localhost:11434",
      temperature: this.config.defaultTemperature || 0.7,
      numPredict: this.config.defaultMaxTokens,
    });
  }

  getBaseUrl(): string {
    return this.config.baseUrl || 'http://localhost:11434';
  }

  setBaseUrl(baseUrl: string): void {
    this.config.baseUrl = baseUrl;
  }

  async checkStatus(): Promise<boolean> {
    try {
      // Check if Ollama is accessible by making a simple request
      const baseUrl = this.config.baseUrl || 'http://localhost:11434';
      await axios.get(`${baseUrl}/api/tags`);
      return true;
    } catch (error) {
      return false;
    }
  }
}
