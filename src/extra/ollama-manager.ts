/* export class OllamaManager {
private containerName = 'cluster-ollama';

async ensureOllamaRunning(): Promise<string> {
    // Check if Ollama container is already running
    if (await this.isOllamaContainerRunning()) {
      return await this.getOllamaEndpoint();
    }

    // Pull and run Ollama container with minimal configuration
    return await this.startOllamaContainer();
  }

  private async startOllamaContainer(): Promise<string> {
    console.log('Starting Ollama container...');

    // Pull Ollama image
    await $`docker pull ollama/ollama:latest`;

    // Generate runtime configuration (no files written)
    const containerConfig = this.generateContainerConfig();

    // Start container with procedural configuration
    await $`docker run -d \
        --name ${this.containerName} \
        -p 11434:11434 \
        -v ollama-data:/root/.ollama \
        ${containerConfig.gpuFlags} \
        ollama/ollama:latest`;

    // Wait for Ollama to be ready
    await this.waitForOllamaReady();

    return 'http://localhost:11434';
  }

  private generateContainerConfig() {
    const hasNvidiaGpu = this.detectNvidiaGpu();

    return {
      gpuFlags: hasNvidiaGpu ? '--gpus all' : '',
      memoryLimit: this.getOptimalMemoryLimit(),
    };
  }

  private async detectNvidiaGpu(): Promise<boolean> {
    try {
      await $`nvidia-smi`;
      return true;
    } catch {
      return false;
    }
  }

  private async waitForOllamaReady(): Promise<void> {
    const maxAttempts = 30;
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await fetch('http://localhost:11434/api/tags');
        if (response.ok) return;
      } catch { }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error('Ollama failed to start within timeout');
  }
} */