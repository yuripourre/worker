/**
 * ComfyUI Workflow Parser
 * Extracts required models, LoRAs, and other dependencies from ComfyUI workflows
 */

export interface WorkflowDependency {
  type: 'model' | 'lora' | 'vae' | 'upscaler' | 'controlnet' | 'embedding';
  name: string;
  nodeId: string;
  nodeType: string;
  required: boolean;
}

export interface WorkflowAnalysis {
  dependencies: WorkflowDependency[];
  hasCheckpointLoader: boolean;
  hasLoRALoader: boolean;
  hasVAELoader: boolean;
  hasUpscaler: boolean;
  hasControlNet: boolean;
  hasEmbedding: boolean;
  missingDependencies: WorkflowDependency[];
}

export class ComfyUIWorkflowParser {
  /**
   * Parse a ComfyUI workflow and extract all dependencies
   */
  static parseWorkflow(workflow: any): WorkflowAnalysis {
    const dependencies: WorkflowDependency[] = [];
    const missingDependencies: WorkflowDependency[] = [];
    
    let hasCheckpointLoader = false;
    let hasLoRALoader = false;
    let hasVAELoader = false;
    let hasUpscaler = false;
    let hasControlNet = false;
    let hasEmbedding = false;

    if (!workflow || !workflow.nodes) {
      return {
        dependencies: [],
        hasCheckpointLoader: false,
        hasLoRALoader: false,
        hasVAELoader: false,
        hasUpscaler: false,
        hasControlNet: false,
        hasEmbedding: false,
        missingDependencies: []
      };
    }

    // Parse each node in the workflow
    for (const [nodeId, node] of Object.entries(workflow.nodes)) {
      const nodeData = node as any;
      const classType = nodeData.class_type;
      const inputs = nodeData.inputs || {};

      switch (classType) {
        case 'CheckpointLoaderSimple':
          hasCheckpointLoader = true;
          if (inputs.ckpt_name) {
            dependencies.push({
              type: 'model',
              name: inputs.ckpt_name,
              nodeId,
              nodeType: classType,
              required: true
            });
          }
          break;

        case 'CheckpointLoader':
          hasCheckpointLoader = true;
          if (inputs.ckpt_name) {
            dependencies.push({
              type: 'model',
              name: inputs.ckpt_name,
              nodeId,
              nodeType: classType,
              required: true
            });
          }
          break;

        case 'LoRA':
        case 'LoRALoader':
          hasLoRALoader = true;
          if (inputs.lora_name) {
            dependencies.push({
              type: 'lora',
              name: inputs.lora_name,
              nodeId,
              nodeType: classType,
              required: true
            });
          }
          break;

        case 'VAELoader':
          hasVAELoader = true;
          if (inputs.vae_name) {
            dependencies.push({
              type: 'vae',
              name: inputs.vae_name,
              nodeId,
              nodeType: classType,
              required: true
            });
          }
          break;

        case 'UpscaleModelLoader':
        case 'ImageUpscaleWithModel':
          hasUpscaler = true;
          if (inputs.model_name) {
            dependencies.push({
              type: 'upscaler',
              name: inputs.model_name,
              nodeId,
              nodeType: classType,
              required: true
            });
          }
          break;

        case 'ControlNetLoader':
          hasControlNet = true;
          if (inputs.control_net_name) {
            dependencies.push({
              type: 'controlnet',
              name: inputs.control_net_name,
              nodeId,
              nodeType: classType,
              required: true
            });
          }
          break;

        case 'CLIPTextEncode':
          // Check for embeddings in text prompts
          if (inputs.text && typeof inputs.text === 'string') {
            const embeddingMatches = inputs.text.match(/<[^>]+>/g);
            if (embeddingMatches) {
              hasEmbedding = true;
              for (const embedding of embeddingMatches) {
                dependencies.push({
                  type: 'embedding',
                  name: embedding.replace(/[<>]/g, ''),
                  nodeId,
                  nodeType: classType,
                  required: true
                });
              }
            }
          }
          break;

        case 'LoadImage':
          // Check for external image dependencies
          if (inputs.image) {
            dependencies.push({
              type: 'model', // Treat as model dependency for now
              name: inputs.image,
              nodeId,
              nodeType: classType,
              required: false
            });
          }
          break;
      }
    }

    // For now, mark all dependencies as missing (in a real implementation, 
    // this would check against available models)
    missingDependencies.push(...dependencies);

    return {
      dependencies,
      hasCheckpointLoader,
      hasLoRALoader,
      hasVAELoader,
      hasUpscaler,
      hasControlNet,
      hasEmbedding,
      missingDependencies
    };
  }

  /**
   * Check if a workflow has all required dependencies available
   */
  static hasAllDependencies(analysis: WorkflowAnalysis, availableModels: string[] = []): boolean {
    return analysis.missingDependencies.length === 0;
  }

  /**
   * Get missing models and LoRAs that need to be requested
   */
  static getMissingModels(analysis: WorkflowAnalysis): WorkflowDependency[] {
    return analysis.missingDependencies.filter(dep => 
      dep.type === 'model' || dep.type === 'lora'
    );
  }

  /**
   * Get missing other dependencies (VAE, upscaler, etc.)
   */
  static getMissingOtherDependencies(analysis: WorkflowAnalysis): WorkflowDependency[] {
    return analysis.missingDependencies.filter(dep => 
      dep.type !== 'model' && dep.type !== 'lora'
    );
  }

  /**
   * Create a summary of the workflow analysis
   */
  static createSummary(analysis: WorkflowAnalysis): string {
    const summary = [];

    if (analysis.dependencies.length === 0) {
      summary.push('No dependencies found in workflow');
      return summary.join('\n');
    }

    summary.push(`Workflow Analysis Summary:`);
    summary.push(`- Total dependencies: ${analysis.dependencies.length}`);
    summary.push(`- Missing dependencies: ${analysis.missingDependencies.length}`);

    if (analysis.hasCheckpointLoader) {
      summary.push(`- Checkpoint loader: Yes`);
    }
    if (analysis.hasLoRALoader) {
      summary.push(`- LoRA loader: Yes`);
    }
    if (analysis.hasVAELoader) {
      summary.push(`- VAE loader: Yes`);
    }
    if (analysis.hasUpscaler) {
      summary.push(`- Upscaler: Yes`);
    }
    if (analysis.hasControlNet) {
      summary.push(`- ControlNet: Yes`);
    }
    if (analysis.hasEmbedding) {
      summary.push(`- Embeddings: Yes`);
    }

    if (analysis.missingDependencies.length > 0) {
      summary.push(`\nMissing Dependencies:`);
      const byType = analysis.missingDependencies.reduce((acc, dep) => {
        if (!acc[dep.type]) acc[dep.type] = [];
        acc[dep.type].push(dep.name);
        return acc;
      }, {} as Record<string, string[]>);

      for (const [type, names] of Object.entries(byType)) {
        summary.push(`  ${type}: ${names.join(', ')}`);
      }
    }

    return summary.join('\n');
  }

  /**
   * Convert ComfyUI frontend/UI workflow format to API format
   * Frontend format: { nodes: [ {id, type, inputs: [], outputs: [], widgets_values: []} ], links: [] }
   * API format: { "nodeId": { class_type: "NodeType", inputs: { param: value } } }
   */
  static convertFrontendToAPI(frontendWorkflow: any): Record<string, any> {
    // If it's already in API format (object with numeric keys), return as-is
    if (!frontendWorkflow.nodes || !Array.isArray(frontendWorkflow.nodes)) {
      return frontendWorkflow;
    }

    const apiFormat: Record<string, any> = {};
    const nodes = frontendWorkflow.nodes;
    const links = frontendWorkflow.links || [];

    // Create a map of link IDs to their source [nodeId, outputIndex]
    const linkMap = new Map<number, [string, number]>();
    for (const link of links) {
      const [linkId, sourceNodeId, sourceSlot] = link;
      linkMap.set(linkId, [String(sourceNodeId), sourceSlot]);
    }

    // Convert each node
    for (const node of nodes) {
      const nodeId = String(node.id);
      const inputs: Record<string, any> = {};

      // Process inputs - convert link references
      if (node.inputs && Array.isArray(node.inputs)) {
        for (const input of node.inputs) {
          if (input.link !== undefined && input.link !== null) {
            // This input comes from a link
            const linkInfo = linkMap.get(input.link);
            if (linkInfo) {
              inputs[input.name] = linkInfo;
            }
          }
        }
      }

      // Add widget values to inputs
      if (node.widgets_values && Array.isArray(node.widgets_values)) {
        // Map widget values to their parameter names based on node type
        switch (node.type) {
          case 'CLIPTextEncode':
            if (node.widgets_values[0] !== undefined) {
              inputs.text = node.widgets_values[0];
            }
            break;
          case 'CheckpointLoaderSimple':
            if (node.widgets_values[0] !== undefined) {
              inputs.ckpt_name = node.widgets_values[0];
            }
            break;
          case 'EmptyLatentImage':
            if (node.widgets_values.length >= 3) {
              inputs.width = node.widgets_values[0];
              inputs.height = node.widgets_values[1];
              inputs.batch_size = node.widgets_values[2];
            }
            break;
          case 'KSampler':
            if (node.widgets_values.length >= 7) {
              inputs.seed = node.widgets_values[0];
              inputs.control_after_generate = node.widgets_values[1];
              inputs.steps = node.widgets_values[2];
              inputs.cfg = node.widgets_values[3];
              inputs.sampler_name = node.widgets_values[4];
              inputs.scheduler = node.widgets_values[5];
              inputs.denoise = node.widgets_values[6];
            }
            break;
          case 'SaveImage':
            if (node.widgets_values[0] !== undefined) {
              inputs.filename_prefix = node.widgets_values[0];
            }
            break;
          case 'VAEDecode':
            // VAEDecode typically has no widget values, only inputs
            break;
          case 'VAEEncode':
            // VAEEncode typically has no widget values, only inputs
            break;
          case 'LoadImage':
            if (node.widgets_values[0] !== undefined) {
              inputs.image = node.widgets_values[0];
            }
            break;
          // Add more node types as needed
          default:
            // For unknown node types, try to use widgets_values as generic parameters
            if (node.widgets_values.length > 0) {
              // This is a fallback - may not work for all node types
              node.widgets_values.forEach((value: any, index: number) => {
                inputs[`param_${index}`] = value;
              });
            }
        }
      }

      apiFormat[nodeId] = {
        inputs: inputs,
        class_type: node.type,
        _meta: {
          title: node.type
        }
      };
    }

    return apiFormat;
  }
}
