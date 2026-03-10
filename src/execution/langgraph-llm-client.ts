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
import type { LLMToolDefinition } from '../shared';
import { runLocalTool } from './local-tool-runner';

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
    format?: 'json' | Record<string, unknown>;
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
    ...(options.format !== undefined && { format: options.format }),
  };
}

const StateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
  }),
});

/**
 * Build a Zod schema from LLMToolDefinition.parameters (name, type, required, enum).
 */
function buildZodSchemaFromParameters(parameters: LLMToolDefinition['parameters']): z.ZodObject<any> {
  const schemaObj: Record<string, z.ZodTypeAny> = {};
  for (const p of parameters) {
    let field: z.ZodTypeAny;
    if (Array.isArray(p.enum) && p.enum.length > 0) {
      field = z.enum(p.enum as [string, ...string[]]);
    } else if (p.type === 'number') {
      field = z.number();
    } else if (p.type === 'boolean') {
      field = z.boolean();
    } else {
      field = z.string();
    }
    if (p.description) field = field.describe(p.description);
    if (!p.required) field = field.optional();
    schemaObj[p.name] = field;
  }
  return z.object(schemaObj) as z.ZodObject<any>;
}

/**
 * Build a LangChain DynamicStructuredTool from an LLMToolDefinition.
 * Executes the tool locally as a subprocess (stdin: JSON args, stdout: result).
 */
function createDynamicToolFromDefinition(tool: LLMToolDefinition): any {
  if (!tool.name || typeof tool.name !== 'string') {
    throw new Error('Tool is missing required field "name"');
  }
  const parameters = tool.parameters ?? [];

  // @ts-ignore - Type instantiation is excessively deep (TypeScript limitation with complex generics)
  const schema = buildZodSchemaFromParameters(parameters);

  // @ts-ignore - Type instantiation is excessively deep (TypeScript limitation with complex generics)
  return new DynamicStructuredTool({
    name: tool.name,
    description: tool.description ?? tool.name,
    schema,
    func: async (input: Record<string, unknown>) => {
      try {
        const runOptions = tool._absolutePath ? { absolutePath: tool._absolutePath } : undefined;
        const result = await runLocalTool(tool.name, input, tool.entryPoint, runOptions);
        console.log(`[Tool] ${tool.name} succeeded: ${result.slice(0, 200)}`);
        return result || '{}';
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[Tool] ${tool.name} failed: ${msg}`);
        throw error;
      }
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
      if (options.tools && options.tools.length > 0) {
        return await this.chatWithTools(options);
      }
      return await this.chatWithoutTools(options);
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
    format?: 'json' | Record<string, unknown>;
  }): Promise<LLMChatResponse> {
    const ollamaBaseUrl = this.config.baseUrl || "http://localhost:11434";
    const model = options.model || this.config.defaultModel || DEFAULT_MODEL;
    const temperature = options.temperature !== undefined ? options.temperature : this.config.defaultTemperature || DEFAULT_TEMPERATURE;
    const numPredict = options.numPredict ?? this.config.defaultMaxTokens ?? DEFAULT_MAX_TOKENS;

    const llm = new ChatOllama(
      buildChatOllamaConfig(
        { model, baseUrl: ollamaBaseUrl, temperature, numPredict },
        {
          numCtx: options.numCtx,
          numPredict: options.numPredict,
          topP: options.topP,
          topK: options.topK,
          repeatPenalty: options.repeatPenalty,
          seed: options.seed,
          format: options.format,
        }
      )
    );

    const messages: BaseMessage[] = [];
    if (options.systemPrompt) {
      messages.push(new SystemMessage(options.systemPrompt));
    }
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
    const content = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

    const debugInfo: LLMDebugInfo = {
      systemPrompt: options.systemPrompt,
      userPrompt: options.prompt,
      model,
      temperature,
    };

    return { content, debugInfo };
  }

  private async chatWithTools(options: LLMChatOptions): Promise<LLMChatResponse> {
    const tools = options.tools!;

    // Build LangChain tools from LLMToolDefinition, skipping any that fail to construct
    const langchainTools: any[] = [];
    const toolErrors: string[] = [];
    for (const tool of tools) {
      try {
        langchainTools.push(createDynamicToolFromDefinition(tool));
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`Failed to create tool ${tool.name}:`, msg);
        toolErrors.push(`${tool.name}: ${msg}`);
      }
    }

    if (langchainTools.length === 0) {
      console.warn(`No valid tools; errors: ${toolErrors.join('; ')}. Falling back to plain LLM.`);
      return this.chatWithoutTools(options);
    }
    if (toolErrors.length > 0) {
      console.warn(`Some tools failed to load: ${toolErrors.join('; ')}`);
    }

    const ollamaBaseUrl = this.config.baseUrl || "http://localhost:11434";
    const model = options.model || this.config.defaultModel || DEFAULT_MODEL;
    const temperature = options.temperature !== undefined ? options.temperature : this.config.defaultTemperature || DEFAULT_TEMPERATURE;
    const numPredict = options.numPredict ?? this.config.defaultMaxTokens ?? DEFAULT_MAX_TOKENS;

    const llm = new ChatOllama(
      buildChatOllamaConfig(
        { model, baseUrl: ollamaBaseUrl, temperature, numPredict },
        {
          numCtx: options.numCtx,
          numPredict: options.numPredict,
          topP: options.topP,
          topK: options.topK,
          repeatPenalty: options.repeatPenalty,
          seed: options.seed,
          format: options.format,
        }
      )
    );

    // @ts-ignore - Type instantiation is excessively deep (TypeScript limitation with complex generics)
    const llmWithTools = llm.bindTools(langchainTools as any);
    const toolNode = new ToolNode(langchainTools as any);

    const callModel = async (state: typeof StateAnnotation.State) => {
      const response = await llmWithTools.invoke(state.messages);
      return { messages: [response] };
    };

    const shouldContinue = (state: typeof StateAnnotation.State) => {
      if (state.messages.length === 0) return END;
      const lastMessage = state.messages[state.messages.length - 1];
      if (!lastMessage) return END;
      return ('tool_calls' in lastMessage &&
        Array.isArray(lastMessage.tool_calls) &&
        lastMessage.tool_calls.length > 0)
        ? 'tools'
        : END;
    };

    const workflow = new StateGraph(StateAnnotation)
      .addNode('agent', callModel)
      .addNode('tools', toolNode)
      .addEdge('__start__', 'agent')
      .addConditionalEdges('agent', shouldContinue, { tools: 'tools', [END]: END })
      .addEdge('tools', 'agent');

    const app = workflow.compile();

    const messages: BaseMessage[] = [];
    if (options.systemPrompt) {
      messages.push(new SystemMessage(options.systemPrompt));
    }
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

    const lastMessage = result.messages[result.messages.length - 1];
    const content = typeof lastMessage.content === 'string'
      ? lastMessage.content
      : JSON.stringify(lastMessage.content);

    // Extract tool call debug info
    const toolCalls: LLMDebugInfo['toolCalls'] = [];
    for (const msg of result.messages) {
      if ('tool_calls' in msg && Array.isArray(msg.tool_calls)) {
        for (const toolCall of msg.tool_calls) {
          const toolResultMsg = result.messages.find(m =>
            'role' in m && m.role === 'tool' &&
            'tool_call_id' in m && m.tool_call_id === toolCall.id
          );
          toolCalls.push({
            name: toolCall.name || 'unknown',
            args: toolCall.args || {},
            result: toolResultMsg && 'content' in toolResultMsg
              ? (typeof toolResultMsg.content === 'string' ? toolResultMsg.content : JSON.stringify(toolResultMsg.content))
              : undefined,
          });
        }
      }
    }

    const debugInfo: LLMDebugInfo = {
      systemPrompt: options.systemPrompt,
      userPrompt: options.prompt,
      model,
      temperature,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      availableTools: tools.map(t => ({
        name: t.name,
        description: t.description,
        type: t.type,
      })),
      messages: result.messages.map(msg => {
        if (msg instanceof SystemMessage) {
          return { role: 'system' as const, content: msg.content };
        } else if (msg instanceof HumanMessage) {
          return { role: 'user' as const, content: msg.content };
        } else if ('role' in msg && msg.role === 'tool') {
          return { role: 'tool' as const, content: 'content' in msg ? msg.content : '' };
        }
        return { role: 'assistant' as const, content: 'content' in msg ? msg.content : '' };
      }),
    };

    return { content, debugInfo };
  }

  getConfig(): LLMConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<LLMConfig>): void {
    this.config = { ...this.config, ...config };
    this.llm = new ChatOllama({
      model: this.config.defaultModel || DEFAULT_MODEL,
      baseUrl: this.config.baseUrl || "http://localhost:11434",
      temperature: this.config.defaultTemperature || DEFAULT_TEMPERATURE,
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
      const baseUrl = this.config.baseUrl || 'http://localhost:11434';
      await axios.get(`${baseUrl}/api/tags`);
      return true;
    } catch {
      return false;
    }
  }
}
