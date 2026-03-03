/* export class DockerManager {
    async ensureDockerRunning(): Promise<boolean> {
      // Check if Docker is already running
      if (await this.isDockerRunning()) {
        return true;
      }
  
      // Check if Docker is installed but not running
      if (await this.isDockerInstalled()) {
        return await this.startDocker();
      }
  
      // Install Docker if not present
      return await this.installDocker();
    }
  
    private async isDockerRunning(): Promise<boolean> {
      try {
        const { stdout } = await $`docker info`;
        return true;
      } catch {
        return false;
      }
    }
  
    private async installDocker(): Promise<boolean> {
      const platform = process.platform;
      
      switch (platform) {
        case 'linux':
          return await this.installDockerLinux();
        case 'darwin':
          return await this.installDockerMac();
        case 'win32':
          return await this.installDockerWindows();
        default:
          throw new Error(`Unsupported platform: ${platform}`);
      }
    }
  
    private async installDockerLinux(): Promise<boolean> {
      console.log('Installing Docker...');
      
      // Download and execute Docker install script directly
      const installScript = await fetch('https://get.docker.com').then(r => r.text());
      
      // Execute script without writing to disk
      await $`sh -c ${installScript}`;
      
      // Start Docker service
      await $`sudo systemctl start docker`;
      await $`sudo systemctl enable docker`;
      
      // Add current user to docker group (requires re-login)
      await $`sudo usermod -aG docker $USER`;
      
      return await this.isDockerRunning();
    }
  } */