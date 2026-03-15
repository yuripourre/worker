import { ExecutableJob, ExecutableJobResult, JobCategory, type JobCategoryType } from '../types';
import type { Workspace } from '../types';
import { LLMClient } from '../llm-client';
import { CategoryExecutor } from './category/category-executor';
import { LLMCategoryExecutor } from './category/llm-category-executor';
import { ScriptCategoryExecutor } from './category/script-category-executor';
import { ImageGenerationCategoryExecutor } from './category/image-generation-category-executor';
import { HttpRequestCategoryExecutor } from './category/http-request-category-executor';
import { ImageCategoryExecutor } from './category/image-category-executor';
import { InformationRequestCategoryExecutor } from './category/information-request-category-executor';
import { ModelManagementCategoryExecutor } from './category/model-management-category-executor';
import { WorkerConfigCategoryExecutor } from './category/worker-config-category-executor';
import { FFMPEGCategoryExecutor } from './category/ffmpeg-category-executor';
import { FileCategoryExecutor } from './category/file-category-executor';
import { FileTransferCategoryExecutor } from './category/file-transfer-category-executor';

export class Executor {
  private categoryExecutors: Map<JobCategoryType, CategoryExecutor>;
  private llmClient: LLMClient;
  private baseUrl?: string;
  private deviceId?: string;
  private workerId?: string;
  private ollamaBaseUrl?: string;
  private comfyuiPath?: string;
  private ipAddress?: string;
  private getConfig?: () => { comfyuiPath?: string; comfyuiBaseUrl?: string; ollamaBaseUrl?: string };
  private setConfig?: (updates: { comfyuiPath?: string; comfyuiBaseUrl?: string; ollamaBaseUrl?: string }) => void;
  private getWorkspaces?: () => Workspace[];

  constructor(
    llmClient: LLMClient,
    baseUrl?: string,
    deviceId?: string,
    workerId?: string,
    getConfig?: () => { comfyuiPath?: string; comfyuiBaseUrl?: string; ollamaBaseUrl?: string },
    ollamaBaseUrl?: string,
    comfyuiPath?: string,
    setConfig?: (updates: { comfyuiPath?: string; comfyuiBaseUrl?: string; ollamaBaseUrl?: string }) => void,
    getWorkspaces?: () => Workspace[],
    ipAddress?: string
  ) {
    this.llmClient = llmClient;
    this.baseUrl = baseUrl;
    this.deviceId = deviceId;
    this.workerId = workerId;
    this.getConfig = getConfig;
    this.setConfig = setConfig;
    this.ollamaBaseUrl = ollamaBaseUrl;
    this.comfyuiPath = comfyuiPath;
    this.getWorkspaces = getWorkspaces;
    this.ipAddress = ipAddress;
    this.categoryExecutors = new Map();

    this.initializeCategoryExecutors();
  }

  private initializeCategoryExecutors(): void {
    this.categoryExecutors.set(JobCategory.LLM, new LLMCategoryExecutor(this.llmClient));
    this.categoryExecutors.set(JobCategory.SCRIPT, new ScriptCategoryExecutor(this.llmClient, this.baseUrl, this.deviceId, this.workerId, this.getWorkspaces));
    this.categoryExecutors.set(JobCategory.IMAGE_GENERATION, new ImageGenerationCategoryExecutor(this.llmClient, this.baseUrl, this.deviceId, this.workerId));
    this.categoryExecutors.set(JobCategory.HTTP_REQUEST, new HttpRequestCategoryExecutor(this.baseUrl, this.deviceId, this.workerId));
    this.categoryExecutors.set(JobCategory.IMAGE, new ImageCategoryExecutor(this.baseUrl, this.deviceId, this.workerId));
    this.categoryExecutors.set(JobCategory.INFORMATION_REQUEST, new InformationRequestCategoryExecutor(this.baseUrl, this.deviceId, this.workerId, this.ollamaBaseUrl, this.comfyuiPath));
    this.categoryExecutors.set(JobCategory.MODEL_MANAGEMENT, new ModelManagementCategoryExecutor(this.baseUrl, this.deviceId, this.workerId, this.ollamaBaseUrl, this.comfyuiPath));
    this.categoryExecutors.set(JobCategory.WORKER_CONFIG, new WorkerConfigCategoryExecutor(this.getConfig, this.setConfig));
    this.categoryExecutors.set(JobCategory.FFMPEG, new FFMPEGCategoryExecutor());
    this.categoryExecutors.set(JobCategory.FILE, new FileCategoryExecutor(this.baseUrl, this.deviceId, this.workerId, this.getWorkspaces));
    this.categoryExecutors.set(JobCategory.FILE_TRANSFER, new FileTransferCategoryExecutor(this.baseUrl, this.deviceId, this.workerId, this.ipAddress));
  }

  /**
   * Update ComfyUI path and recreate affected category executors
   */
  updateComfyUIPath(path: string): void {
    this.comfyuiPath = path;
    this.categoryExecutors.set(JobCategory.INFORMATION_REQUEST, new InformationRequestCategoryExecutor(this.baseUrl, this.deviceId, this.workerId, this.ollamaBaseUrl, this.comfyuiPath));
    this.categoryExecutors.set(JobCategory.MODEL_MANAGEMENT, new ModelManagementCategoryExecutor(this.baseUrl, this.deviceId, this.workerId, this.ollamaBaseUrl, this.comfyuiPath));
  }

  /**
   * Update Ollama base URL and recreate affected category executors
   */
  updateOllamaBaseUrl(url: string): void {
    this.ollamaBaseUrl = url;
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
