import { ExecutableJob, ExecutableJobResult, JobCategory } from '../types';
import { LLMClient } from '../llm-client';
import { CategoryExecutor } from './category/category-executor';
import { LLMCategoryExecutor } from './category/llm-category-executor';
import { ScriptCategoryExecutor } from './category/script-category-executor';
import { FileRequestCategoryExecutor } from './category/file-request-category-executor';
import { ImageGenerationCategoryExecutor } from './category/image-generation-category-executor';
import { HttpRequestCategoryExecutor } from './category/http-request-category-executor';
import { ImageCategoryExecutor } from './category/image-category-executor';
import { InformationRequestCategoryExecutor } from './category/information-request-category-executor';
import { ModelManagementCategoryExecutor } from './category/model-management-category-executor';

export class Executor {
  private categoryExecutors: Map<JobCategory, CategoryExecutor>;
  private llmClient: LLMClient;
  private baseUrl?: string;
  private deviceId?: string;
  private workerId?: string;
  private existingLocalServer?: any;
  private ollamaBaseUrl?: string;
  private comfyuiPath?: string;

  constructor(
    llmClient: LLMClient,
    baseUrl?: string,
    deviceId?: string,
    workerId?: string,
    existingLocalServer?: any, // LocalServer instance if available
    ollamaBaseUrl?: string,
    comfyuiPath?: string
  ) {
    this.llmClient = llmClient;
    this.baseUrl = baseUrl;
    this.deviceId = deviceId;
    this.workerId = workerId;
    this.existingLocalServer = existingLocalServer;
    this.ollamaBaseUrl = ollamaBaseUrl;
    this.comfyuiPath = comfyuiPath;
    this.categoryExecutors = new Map();

    this.initializeCategoryExecutors();
  }

  private initializeCategoryExecutors(): void {
    // Initialize category executors
    this.categoryExecutors.set(JobCategory.LLM, new LLMCategoryExecutor(this.llmClient));
    this.categoryExecutors.set(JobCategory.SCRIPT, new ScriptCategoryExecutor(this.llmClient, this.baseUrl, this.deviceId, this.workerId));
    this.categoryExecutors.set(JobCategory.FILE_REQUEST, new FileRequestCategoryExecutor(this.baseUrl, this.deviceId, this.workerId, this.existingLocalServer));
    this.categoryExecutors.set(JobCategory.IMAGE_GENERATION, new ImageGenerationCategoryExecutor(this.llmClient, this.baseUrl, this.deviceId, this.workerId));
    this.categoryExecutors.set(JobCategory.HTTP_REQUEST, new HttpRequestCategoryExecutor(this.baseUrl, this.deviceId, this.workerId));
    this.categoryExecutors.set(JobCategory.IMAGE, new ImageCategoryExecutor(this.baseUrl, this.deviceId, this.workerId));
    this.categoryExecutors.set(JobCategory.INFORMATION_REQUEST, new InformationRequestCategoryExecutor(this.baseUrl, this.deviceId, this.workerId, this.ollamaBaseUrl, this.comfyuiPath));
    this.categoryExecutors.set(JobCategory.MODEL_MANAGEMENT, new ModelManagementCategoryExecutor(this.baseUrl, this.deviceId, this.workerId, this.ollamaBaseUrl, this.comfyuiPath));
  }

  /**
   * Update ComfyUI path and recreate affected category executors
   */
  updateComfyUIPath(path: string): void {
    this.comfyuiPath = path;
    // Recreate category executors that use comfyuiPath
    this.categoryExecutors.set(JobCategory.INFORMATION_REQUEST, new InformationRequestCategoryExecutor(this.baseUrl, this.deviceId, this.workerId, this.ollamaBaseUrl, this.comfyuiPath));
    this.categoryExecutors.set(JobCategory.MODEL_MANAGEMENT, new ModelManagementCategoryExecutor(this.baseUrl, this.deviceId, this.workerId, this.ollamaBaseUrl, this.comfyuiPath));
  }

  /**
   * Update Ollama base URL and recreate affected category executors
   */
  updateOllamaBaseUrl(url: string): void {
    this.ollamaBaseUrl = url;
    // Recreate category executors that use ollamaBaseUrl
    this.categoryExecutors.set(JobCategory.INFORMATION_REQUEST, new InformationRequestCategoryExecutor(this.baseUrl, this.deviceId, this.workerId, this.ollamaBaseUrl, this.comfyuiPath));
    this.categoryExecutors.set(JobCategory.MODEL_MANAGEMENT, new ModelManagementCategoryExecutor(this.baseUrl, this.deviceId, this.workerId, this.ollamaBaseUrl, this.comfyuiPath));
  }

  async executeExecution(job: ExecutableJob): Promise<ExecutableJobResult> {
    const executor = this.categoryExecutors.get(job.category);
    if (!executor) {
      throw new Error(`No executor found for category: ${job.category}`);
    }
    return executor.executeExecution(job);
  }

  getName(): string {
    return 'CategoryRouterExecutor';
  }

  getLLMClient(): LLMClient {
    return this.llmClient;
  }
}
