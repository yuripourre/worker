import { execSync } from 'child_process';
import { cpus, totalmem, freemem, platform, arch, release, hostname, uptime, networkInterfaces } from 'os';
import { readFileSync, existsSync, readdirSync } from 'fs';

export interface SystemInfo {
  system: {
    hostname: string;
    platform: string;
    architecture: string;
    release: string;
    osVersion?: string;
  };
  cpu: {
    model: string;
    cores: number;
    threads: number;
    speed: number;
    cache?: string;
    temperature?: string;
  };
  memory: {
    total: string;
    free: string;
    used: string;
    usagePercent: number;
  };
  storage: Array<{
    filesystem: string;
    size: string;
    used: string;
    available: string;
    usePercent: string;
    mountPoint: string;
  }>;
  gpu?: Array<{
    name: string;
    memory?: string;
    memoryUsed?: string;
    memoryUsagePercent?: number;
  }>;
  network: Array<{
    interface: string;
    ip: string;
    mac?: string;
    type?: string;
  }>;
}

export interface CurrentResourceUsage {
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  temperature: number;
}

export class SpecsAnalyzer {
  private currentPlatform = platform();

  private formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  private execCommand(command: string): string {
    try {
      return execSync(command, { encoding: 'utf8', timeout: 5000 }).trim();
    } catch (error) {
      return 'N/A';
    }
  }

  private getSystemInfo(): SystemInfo['system'] {
    let osVersion = 'N/A';

    // Get OS version based on platform
    switch (this.currentPlatform) {
      case 'win32':
        osVersion = this.execCommand('wmic os get Caption,Version /format:list | findstr "="');
        break;
      case 'darwin':
        osVersion = this.execCommand('sw_vers -productVersion');
        break;
      case 'linux':
        if (existsSync('/etc/os-release')) {
          try {
            const osRelease = readFileSync('/etc/os-release', 'utf8');
            const prettyNameMatch = osRelease.match(/PRETTY_NAME="(.+)"/);
            if (prettyNameMatch) osVersion = prettyNameMatch[1];
          } catch (error) {
            osVersion = this.execCommand('lsb_release -d | cut -f2-');
          }
        }
        break;
    }

    return {
      hostname: hostname(),
      platform: this.currentPlatform,
      architecture: arch(),
      release: release(),
      osVersion: osVersion !== 'N/A' ? osVersion : undefined
    };
  }

  private getCpuInfo(): SystemInfo['cpu'] {
    const cpuInfo = cpus()[0];
    const cores = cpus().length;
    let cache = 'N/A';
    let temperature = 'N/A';

    // Get cache information based on platform
    switch (this.currentPlatform) {
      case 'linux':
        if (existsSync('/proc/cpuinfo')) {
          try {
            const cpuData = readFileSync('/proc/cpuinfo', 'utf8');
            const cacheMatch = cpuData.match(/cache size\s*:\s*(.+)/);
            if (cacheMatch) cache = cacheMatch[1];
          } catch (error) {
            // Ignore error
          }
        }
        // Get temperature using unified method
        const tempValue = this.getUnifiedTemperature();
        temperature = tempValue !== null ? `${tempValue.toFixed(1)}°C` : 'N/A';
        break;

      case 'darwin':
        cache = this.execCommand('sysctl -n hw.l3cachesize') + ' KB';
        if (cache === 'N/A KB') cache = 'N/A';
        // macOS temperature using unified method
        const macTemp = this.getUnifiedTemperature();
        temperature = macTemp !== null ? `${macTemp.toFixed(1)}°C` : 'N/A';
        break;

      case 'win32':
        cache = this.execCommand('wmic cpu get L3CacheSize /format:value | findstr "="');
        // Windows temperature using unified method
        const winTemp = this.getUnifiedTemperature();
        temperature = winTemp !== null ? `${winTemp.toFixed(1)}°C` : 'N/A';
        break;
    }

    return {
      model: cpuInfo.model,
      cores: cores,
      threads: cores,
      speed: cpuInfo.speed,
      cache: cache !== 'N/A' ? cache : undefined,
      temperature: temperature !== 'N/A' ? temperature : undefined
    };
  }

  private getMemoryInfo(): SystemInfo['memory'] {
    const total = totalmem();
    let free = 0;
    let used = 0;
    let usagePercent = 0;

    try {
      if (this.currentPlatform === 'linux') {
        // Read /proc/meminfo for accurate memory calculation on Linux
        const meminfo = readFileSync('/proc/meminfo', 'utf8');
        const memTotalMatch = meminfo.match(/MemTotal:\s+(\d+)\s+kB/);
        const memAvailableMatch = meminfo.match(/MemAvailable:\s+(\d+)\s+kB/);

        if (memTotalMatch && memAvailableMatch) {
          // Use MemAvailable if available (most accurate)
          const memTotalKB = parseInt(memTotalMatch[1]);
          const memAvailableKB = parseInt(memAvailableMatch[1]);
          const memUsedKB = memTotalKB - memAvailableKB;
          free = memAvailableKB * 1024; // Convert to bytes
          used = memUsedKB * 1024;
          usagePercent = (used / total) * 100;
        } else {
          // Fallback: calculate from Free, Buffers, and Cached
          const memFreeMatch = meminfo.match(/MemFree:\s+(\d+)\s+kB/);
          const memBuffersMatch = meminfo.match(/Buffers:\s+(\d+)\s+kB/);
          const memCachedMatch = meminfo.match(/Cached:\s+(\d+)\s+kB/);

          if (memTotalMatch && memFreeMatch) {
            const memTotalKB = parseInt(memTotalMatch[1]);
            const memFreeKB = parseInt(memFreeMatch[1]);
            const memBuffersKB = memBuffersMatch ? parseInt(memBuffersMatch[1]) : 0;
            const memCachedKB = memCachedMatch ? parseInt(memCachedMatch[1]) : 0;
            const memAvailableKB = memFreeKB + memBuffersKB + memCachedKB;
            const memUsedKB = memTotalKB - memAvailableKB;
            free = memAvailableKB * 1024;
            used = memUsedKB * 1024;
            usagePercent = (used / total) * 100;
          } else {
            // Final fallback to Node.js os module
            free = freemem();
            used = total - free;
            usagePercent = (used / total) * 100;
          }
        }
      } else {
        // Non-Linux: use Node.js os module
        free = freemem();
        used = total - free;
        usagePercent = (used / total) * 100;
      }
    } catch (error) {
      // Fallback to Node.js os module if /proc/meminfo is not accessible
      free = freemem();
      used = total - free;
      usagePercent = (used / total) * 100;
    }

    return {
      total: this.formatBytes(total),
      free: this.formatBytes(free),
      used: this.formatBytes(used),
      usagePercent: Math.round(usagePercent)
    };
  }

  private getStorageInfo(): SystemInfo['storage'] {
    const storage: SystemInfo['storage'] = [];

    switch (this.currentPlatform) {
      case 'win32':
        try {
          const wmicOutput = this.execCommand('wmic logicaldisk get Caption,Size,FreeSpace,FileSystem /format:csv');
          const lines = wmicOutput.split('\n').slice(1);

          for (const line of lines) {
            const parts = line.split(',');
            if (parts.length >= 5 && parts[1]) {
              const caption = parts[1];
              const fileSystem = parts[2] || 'N/A';
              const freeSpace = parseInt(parts[3]) || 0;
              const size = parseInt(parts[4]) || 0;
              const used = size - freeSpace;
              const usePercent = size > 0 ? Math.round((used / size) * 100) : 0;

              storage.push({
                filesystem: fileSystem,
                size: this.formatBytes(size),
                used: this.formatBytes(used),
                available: this.formatBytes(freeSpace),
                usePercent: `${usePercent}%`,
                mountPoint: caption
              });
            }
          }
        } catch (error) {
          // Fallback for Windows
          storage.push({
            filesystem: 'NTFS',
            size: 'N/A',
            used: 'N/A',
            available: 'N/A',
            usePercent: 'N/A',
            mountPoint: 'C:\\'
          });
        }
        break;

      case 'darwin':
        try {
          const dfOutput = this.execCommand('df -h');
          const lines = dfOutput.split('\n').slice(1);

          for (const line of lines) {
            const parts = line.split(/\s+/);
            if (parts.length >= 6 && parts[0].startsWith('/dev/')) {
              storage.push({
                filesystem: parts[0],
                size: parts[1],
                used: parts[2],
                available: parts[3],
                usePercent: parts[4],
                mountPoint: parts[8] || parts[5]
              });
            }
          }
        } catch (error) {
          storage.push({
            filesystem: 'APFS',
            size: 'N/A',
            used: 'N/A',
            available: 'N/A',
            usePercent: 'N/A',
            mountPoint: '/'
          });
        }
        break;

      case 'linux':
      default:
        try {
          const dfOutput = this.execCommand('df -h');
          const lines = dfOutput.split('\n').slice(1);

          for (const line of lines) {
            const parts = line.split(/\s+/);
            if (parts.length >= 6 && !parts[0].includes('tmpfs') && !parts[5].includes('/snap/')) {
              storage.push({
                filesystem: parts[0],
                size: parts[1],
                used: parts[2],
                available: parts[3],
                usePercent: parts[4],
                mountPoint: parts[5]
              });
            }
          }
        } catch (error) {
          storage.push({
            filesystem: 'ext4',
            size: 'N/A',
            used: 'N/A',
            available: 'N/A',
            usePercent: 'N/A',
            mountPoint: '/'
          });
        }
        break;
    }

    return storage.length > 0 ? storage : [{
      filesystem: 'Unknown',
      size: 'N/A',
      used: 'N/A',
      available: 'N/A',
      usePercent: 'N/A',
      mountPoint: 'N/A'
    }];
  }

  private getGpuInfo(): SystemInfo['gpu'] {
    const gpus: SystemInfo['gpu'] = [];

    switch (this.currentPlatform) {
      case 'win32':
        // Windows - Use WMIC
        try {
          const wmicOutput = this.execCommand('wmic path win32_VideoController get Name,AdapterRAM /format:csv');
          const lines = wmicOutput.split('\n').slice(1);

          for (const line of lines) {
            const parts = line.split(',');
            if (parts.length >= 3 && parts[2]) {
              const memory = parts[1] ? this.formatBytes(parseInt(parts[1])) : undefined;
              gpus.push({
                name: parts[2].trim(),
                memory
              });
            }
          }
        } catch (error) {
          // Fallback
        }
        break;

      case 'darwin':
        // macOS - Use system_profiler
        try {
          const spOutput = this.execCommand('system_profiler SPDisplaysDataType');
          const gpuMatches = spOutput.match(/Chipset Model: (.+)/g);
          const memoryMatches = spOutput.match(/VRAM \(Total\): (.+)/g);

          if (gpuMatches) {
            gpuMatches.forEach((match, index) => {
              const name = match.replace('Chipset Model: ', '');
              const memory = memoryMatches && memoryMatches[index]
                ? memoryMatches[index].replace('VRAM (Total): ', '')
                : undefined;

              gpus.push({ name, memory });
            });
          }
        } catch (error) {
          // Fallback
        }
        break;

      case 'linux':
      default:
        // Try NVIDIA first
        try {
          const nvidiaOutput = this.execCommand('nvidia-smi --query-gpu=name,memory.total,memory.used --format=csv,noheader,nounits');
          if (nvidiaOutput !== 'N/A' && !nvidiaOutput.includes('command not found')) {
            const lines = nvidiaOutput.split('\n');
            for (const line of lines) {
              const parts = line.split(', ');
              if (parts.length >= 2 && parts[0] && parts[0] !== 'N/A') {
                const name = parts[0].trim();
                const memoryTotal = parts[1] ? parseInt(parts[1].trim()) : undefined;
                const memoryUsed = parts[2] ? parseInt(parts[2].trim()) : undefined;
                const memoryUsagePercent = (memoryTotal && memoryUsed)
                  ? Math.round((memoryUsed / memoryTotal) * 100)
                  : undefined;

                gpus.push({
                  name,
                  memory: memoryTotal ? `${memoryTotal} MB` : undefined,
                  memoryUsed: memoryUsed ? `${memoryUsed} MB` : undefined,
                  memoryUsagePercent
                });
              }
            }
          }
        } catch (error) {
          // Ignore error
        }

        // Try lspci if no NVIDIA cards found
        if (gpus.length === 0) {
          try {
            const lspciOutput = this.execCommand('lspci | grep -i vga');
            if (lspciOutput !== 'N/A') {
              const lines = lspciOutput.split('\n');
              for (const line of lines) {
                const match = line.match(/VGA compatible controller: (.+)/);
                if (match) {
                  gpus.push({
                    name: match[1].trim()
                  });
                }
              }
            }
          } catch (error) {
            // Ignore error
          }
        }
        break;
    }

    return gpus.length > 0 ? gpus : undefined;
  }

  private getNetworkInfo(): SystemInfo['network'] {
    const interfaces: SystemInfo['network'] = [];
    const netInterfaces = networkInterfaces();

    for (const [name, addresses] of Object.entries(netInterfaces)) {
      if (!addresses || name === 'lo' || name.includes('Loopback')) continue;

      for (const addr of addresses) {
        if (addr.family === 'IPv4' && !addr.internal) {
          interfaces.push({
            interface: name,
            ip: addr.address,
            mac: addr.mac !== '00:00:00:00:00:00' ? addr.mac : undefined,
            type: addr.family
          });
          break; // Only take the first IPv4 address per interface
        }
      }
    }

    return interfaces.length > 0 ? interfaces : [{
      interface: 'N/A',
      ip: 'N/A'
    }];
  }

  /**
   * Get current CPU usage percentage
   */
  private getCpuUsage(): number {
    try {
      if (this.currentPlatform === 'win32') {
        return this.getWindowsCpuUsage();
      } else {
        return this.getLinuxCpuUsage();
      }
    } catch (error) {
      return 0;
    }
  }

  /**
   * Get CPU usage on Linux systems
   */
  private getLinuxCpuUsage(): number {
    try {
      // Read /proc/stat for CPU information
      const statContent = readFileSync('/proc/stat', 'utf8');
      const lines = statContent.split('\n');
      const cpuLine = lines.find(line => line.startsWith('cpu '));

      if (!cpuLine) return 0;

      // Parse CPU times: user, nice, system, idle, iowait, irq, softirq
      const cpuStats = cpuLine.split(/\s+/).slice(1, 8).map(Number);
      const [user, nice, system, idle, iowait, irq, softirq] = cpuStats;

      // Calculate total and idle time
      const totalTime = user + nice + system + idle + iowait + irq + softirq;
      const idleTime = idle + iowait;

      // Calculate usage percentage
      const usagePercent = totalTime > 0 ? ((totalTime - idleTime) / totalTime * 100) : 0;

      return Math.min(100, Math.max(0, Math.round(usagePercent)));
    } catch (error) {
      return 0;
    }
  }

  /**
   * Get CPU usage on Windows systems
   */
  private getWindowsCpuUsage(): number {
    try {
      // Use WMIC to get CPU usage
      const output = this.execCommand('wmic cpu get loadpercentage /value');
      const match = output.match(/LoadPercentage=(\d+)/);
      return match ? parseInt(match[1]) : 0;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Get current memory usage percentage
   */
  private getMemoryUsage(): number {
    try {
      const totalMemory = totalmem();
      let usedMemory = 0;
      let usagePercent = 0;

      if (this.currentPlatform === 'linux') {
        // Read /proc/meminfo for accurate memory calculation on Linux
        const meminfo = readFileSync('/proc/meminfo', 'utf8');
        const memTotalMatch = meminfo.match(/MemTotal:\s+(\d+)\s+kB/);
        const memAvailableMatch = meminfo.match(/MemAvailable:\s+(\d+)\s+kB/);

        if (memTotalMatch && memAvailableMatch) {
          // Use MemAvailable if available (most accurate)
          const memTotalKB = parseInt(memTotalMatch[1]);
          const memAvailableKB = parseInt(memAvailableMatch[1]);
          const memUsedKB = memTotalKB - memAvailableKB;
          usagePercent = (memUsedKB / memTotalKB) * 100;
        } else {
          // Fallback: calculate from Free, Buffers, and Cached
          const memFreeMatch = meminfo.match(/MemFree:\s+(\d+)\s+kB/);
          const memBuffersMatch = meminfo.match(/Buffers:\s+(\d+)\s+kB/);
          const memCachedMatch = meminfo.match(/Cached:\s+(\d+)\s+kB/);

          if (memTotalMatch && memFreeMatch) {
            const memTotalKB = parseInt(memTotalMatch[1]);
            const memFreeKB = parseInt(memFreeMatch[1]);
            const memBuffersKB = memBuffersMatch ? parseInt(memBuffersMatch[1]) : 0;
            const memCachedKB = memCachedMatch ? parseInt(memCachedMatch[1]) : 0;
            const memAvailableKB = memFreeKB + memBuffersKB + memCachedKB;
            const memUsedKB = memTotalKB - memAvailableKB;
            usagePercent = (memUsedKB / memTotalKB) * 100;
          } else {
            // Final fallback to Node.js os module
            const freeMemory = freemem();
            usedMemory = totalMemory - freeMemory;
            usagePercent = (usedMemory / totalMemory) * 100;
          }
        }
      } else {
        // Non-Linux: use Node.js os module
        const freeMemory = freemem();
        usedMemory = totalMemory - freeMemory;
        usagePercent = (usedMemory / totalMemory) * 100;
      }

      return Math.min(100, Math.max(0, Math.round(usagePercent)));
    } catch (error) {
      // Fallback to Node.js os module if /proc/meminfo is not accessible
      try {
        const totalMemory = totalmem();
        const freeMemory = freemem();
        const usedMemory = totalMemory - freeMemory;
        const usagePercent = (usedMemory / totalMemory) * 100;
        return Math.min(100, Math.max(0, Math.round(usagePercent)));
      } catch (fallbackError) {
        return 0;
      }
    }
  }

  /**
   * Get current disk usage percentage
   */
  private getDiskUsage(): number {
    try {
      if (this.currentPlatform === 'win32') {
        return this.getWindowsDiskUsage();
      } else {
        return this.getLinuxDiskUsage();
      }
    } catch (error) {
      return 0;
    }
  }

  /**
   * Get disk usage on Linux systems
   */
  private getLinuxDiskUsage(): number {
    try {
      // Use df command to get root filesystem usage
      const output = this.execCommand('df / | tail -1');
      const parts = output.trim().split(/\s+/);
      const usagePercent = parseInt(parts[4].replace('%', ''));

      return isNaN(usagePercent) ? 0 : usagePercent;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Get disk usage on Windows systems
   */
  private getWindowsDiskUsage(): number {
    try {
      // Use WMIC to get disk usage for C: drive
      const output = this.execCommand('wmic logicaldisk where name="C:" get size,freespace /value');
      const sizeMatch = output.match(/Size=(\d+)/);
      const freeMatch = output.match(/FreeSpace=(\d+)/);

      if (sizeMatch && freeMatch) {
        const totalSize = parseInt(sizeMatch[1]);
        const freeSpace = parseInt(freeMatch[1]);
        const usedSpace = totalSize - freeSpace;
        const usagePercent = (usedSpace / totalSize) * 100;

        return Math.min(100, Math.max(0, Math.round(usagePercent)));
      }
      return 0;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Get current system temperature
   */
  private getSystemTemperature(): number {
    const temp = this.getUnifiedTemperature();
    return temp !== null ? temp : 35; // Default fallback if no temperature available
  }

  /**
   * Get current system power consumption in watts
   */
  public getPowerConsumption(): string {
    const power = this.getUnifiedPowerConsumption();
    if (power !== null) {
      return `${Math.round(power)}W`;
    }
    // Fallback to estimation if hardware sensors not available
    const estimatedPower = this.estimatePowerConsumption();
    return estimatedPower !== null ? `${Math.round(estimatedPower)}W` : 'Unknown';
  }

  /**
   * Unified power consumption monitoring method - combines the best approaches
   */
  private getUnifiedPowerConsumption(): number | null {
    try {
      switch (this.currentPlatform) {
        case 'linux':
          return this.getLinuxPowerConsumption();
        case 'darwin':
          return this.getMacPowerConsumption();
        case 'win32':
          return this.getWindowsPowerConsumption();
        default:
          return null;
      }
    } catch (error) {
      return null;
    }
  }

  /**
   * Linux power consumption monitoring (Intel RAPL, AMD Energy, NVIDIA)
   */
  private getLinuxPowerConsumption(): number | null {
    let totalPower = 0;
    let hasPowerData = false;

    // Try Intel RAPL (Running Average Power Limit) - most accurate for Intel CPUs
    try {
      const raplPaths = [
        '/sys/class/powercap/intel-rapl/intel-rapl:0/energy_uj',
        '/sys/class/powercap/intel-rapl:0/energy_uj',
        '/sys/devices/virtual/powercap/intel-rapl/intel-rapl:0/energy_uj'
      ];

      for (const raplPath of raplPaths) {
        if (existsSync(raplPath)) {
          // Read energy twice with a small delay to calculate power
          const energy1 = parseInt(readFileSync(raplPath, 'utf8').trim());
          if (!isNaN(energy1)) {
            // Wait 100ms and read again (using a simple delay)
            const startTime = Date.now();
            while (Date.now() - startTime < 100) {
              // Small delay to allow energy counter to update
            }
            const energy2 = parseInt(readFileSync(raplPath, 'utf8').trim());
            if (!isNaN(energy2) && energy2 > energy1) {
              // Energy is in microjoules, convert to watts
              // Power (W) = Energy (J) / Time (s) = (energy2 - energy1) / 1e6 / 0.1
              const power = ((energy2 - energy1) / 1e6) / 0.1;
              if (power > 0 && power < 1000) { // Sanity check: 0-1000W
                totalPower += power;
                hasPowerData = true;
                break;
              }
            }
          }
        }
      }
    } catch (error) {
      // Continue to other methods
    }

    // Try AMD Energy (for AMD processors)
    try {
      const amdEnergyPath = '/sys/devices/virtual/powercap/amd_energy/energy1_input';
      if (existsSync(amdEnergyPath)) {
        const energy1 = parseInt(readFileSync(amdEnergyPath, 'utf8').trim());
        if (!isNaN(energy1)) {
          // Wait 100ms to allow energy counter to update
          const startTime = Date.now();
          while (Date.now() - startTime < 100) {
            // Small delay
          }
          const energy2 = parseInt(readFileSync(amdEnergyPath, 'utf8').trim());
          if (!isNaN(energy2) && energy2 > energy1) {
            // AMD energy is in microjoules
            const power = ((energy2 - energy1) / 1e6) / 0.1;
            if (power > 0 && power < 1000) {
              totalPower += power;
              hasPowerData = true;
            }
          }
        }
      }
    } catch (error) {
      // Continue
    }

    // Try NVIDIA GPU power (nvidia-smi)
    try {
      const nvidiaOutput = this.execCommand('nvidia-smi --query-gpu=power.draw --format=csv,noheader,nounits 2>/dev/null');
      if (nvidiaOutput && nvidiaOutput !== 'N/A' && !nvidiaOutput.includes('command not found')) {
        const lines = nvidiaOutput.trim().split('\n');
        for (const line of lines) {
          const power = parseFloat(line.trim());
          if (!isNaN(power) && power > 0 && power < 1000) {
            totalPower += power;
            hasPowerData = true;
          }
        }
      }
    } catch (error) {
      // Continue
    }

    // Try powertop estimation (if available)
    if (!hasPowerData) {
      try {
        const powertopOutput = this.execCommand('powertop --csv=/dev/stdout 2>/dev/null | grep -i "cpu" | head -1');
        if (powertopOutput && powertopOutput !== 'N/A') {
          // Parse powertop CSV output (format varies)
          const powerMatch = powertopOutput.match(/(\d+\.?\d*)\s*W/i);
          if (powerMatch) {
            const power = parseFloat(powerMatch[1]);
            if (!isNaN(power) && power > 0 && power < 1000) {
              return power;
            }
          }
        }
      } catch (error) {
        // Continue
      }
    }

    return hasPowerData && totalPower > 0 ? totalPower : null;
  }

  /**
   * macOS power consumption monitoring
   */
  private getMacPowerConsumption(): number | null {
    try {
      // Try powermetrics (requires sudo, most accurate)
      const powerOutput = this.execCommand('sudo powermetrics --samplers smc -n 1 -i 1 2>/dev/null | grep -E "(CPU die|Package|Total)" | grep -i "power" | head -1');
      if (powerOutput && powerOutput !== 'N/A') {
        // Parse power output (format: "CPU die temperature: XX.XX C" or "Package power: XX.XX W")
        const powerMatch = powerOutput.match(/(\d+\.?\d*)\s*W/i);
        if (powerMatch) {
          const power = parseFloat(powerMatch[1]);
          if (!isNaN(power) && power > 0 && power < 1000) {
            return power;
          }
        }
      }
    } catch (error) {
      // Continue to other methods
    }

    // Try iostat for CPU power estimation (less accurate)
    try {
      const iostatOutput = this.execCommand('iostat -c 1 2 2>/dev/null | tail -1');
      if (iostatOutput && iostatOutput !== 'N/A') {
        // iostat doesn't directly give power, but we can use it for estimation
        // This is a fallback that would need more sophisticated parsing
      }
    } catch (error) {
      // Continue
    }

    return null;
  }

  /**
   * Windows power consumption monitoring
   */
  private getWindowsPowerConsumption(): number | null {
    try {
      // Try WMI for power information
      const wmiOutput = this.execCommand('wmic path Win32_Battery get EstimatedChargeRemaining,DesignCapacity /format:list 2>nul');
      // Note: This gives battery info, not system power consumption
      // For actual power consumption, we'd need more specialized tools
    } catch (error) {
      // Continue
    }

    try {
      // Try OpenHardwareMonitor (if installed)
      const ohmOutput = this.execCommand('powershell -Command "Get-WmiObject -Namespace \'root\\OpenHardwareMonitor\' -Class \'Sensor\' | Where-Object {$_.SensorType -eq \'Power\'} | Select-Object -First 1 -ExpandProperty Value" 2>nul');
      if (ohmOutput && ohmOutput !== 'N/A' && !isNaN(parseFloat(ohmOutput.trim()))) {
        const power = parseFloat(ohmOutput.trim());
        if (power > 0 && power < 1000) {
          return power;
        }
      }
    } catch (error) {
      // Continue
    }

    return null;
  }

  /**
   * Estimate power consumption based on CPU usage and temperature
   * This is a fallback when hardware sensors are not available
   */
  private estimatePowerConsumption(): number | null {
    try {
      const cpuUsage = this.getCpuUsage();
      const temperature = this.getSystemTemperature();
      const cpuInfo = cpus()[0];
      const cores = cpus().length;

      // Base power consumption estimates (idle power)
      // These are rough estimates and vary by hardware
      const BASE_POWER_PER_CORE = 2; // Watts per core at idle
      const DYNAMIC_POWER_PER_CORE = 8; // Additional watts per core at 100% usage
      const BASE_SYSTEM_POWER = 15; // Base system power (motherboard, RAM, etc.)

      // Estimate CPU power
      const idlePower = cores * BASE_POWER_PER_CORE;
      const dynamicPower = (cores * DYNAMIC_POWER_PER_CORE) * (cpuUsage / 100);
      const estimatedCpuPower = idlePower + dynamicPower;

      // Add base system power
      const totalEstimatedPower = BASE_SYSTEM_POWER + estimatedCpuPower;

      // Adjust based on temperature (higher temp = higher power)
      // If temperature is significantly above idle (say 40°C), add some power
      const tempAdjustment = temperature > 50 ? (temperature - 50) * 0.5 : 0;

      return totalEstimatedPower + tempAdjustment;
    } catch (error) {
      return null;
    }
  }



  /**
   * Unified temperature monitoring method - combines the best approaches
   */
  private getUnifiedTemperature(): number | null {
    try {
      switch (this.currentPlatform) {
        case 'linux':
          return this.getLinuxUnifiedTemperature();
        case 'darwin':
          return this.getMacUnifiedTemperature();
        case 'win32':
          return this.getWindowsUnifiedTemperature();
        default:
          return null;
      }
    } catch (error) {
      return null;
    }
  }

  /**
   * Unified Linux temperature monitoring (most robust)
   */
  private getLinuxUnifiedTemperature(): number | null {
    // Try sensors command first (most accurate)
    try {
      const sensorsOutput = this.execCommand('sensors 2>/dev/null | grep -E "(Core|temp1|Package|CPU)" | head -1');
      if (sensorsOutput && sensorsOutput !== 'N/A') {
        const tempMatch = sensorsOutput.match(/\+(\d+\.\d+)°C/);
        if (tempMatch) {
          return Math.round(parseFloat(tempMatch[1]));
        }
      }
    } catch (error) {
      // Continue to other methods
    }

    // Try multiple hwmon paths
    try {
      const hwmonDirs = readdirSync('/sys/class/hwmon/');
      for (const hwmonDir of hwmonDirs) {
        const tempFile = `/sys/class/hwmon/${hwmonDir}/temp1_input`;
        if (existsSync(tempFile)) {
          const temp = readFileSync(tempFile, 'utf8').trim();
          if (temp && !isNaN(parseInt(temp))) {
            return Math.round(parseInt(temp) / 1000);
          }
        }
      }
    } catch (error) {
      // Continue to thermal zones
    }

    // Try thermal zones
    const thermalPaths = [
      '/sys/class/thermal/thermal_zone0/temp',
      '/sys/class/thermal/thermal_zone1/temp',
      '/sys/devices/platform/coretemp.0/hwmon/hwmon1/temp1_input'
    ];

    for (const path of thermalPaths) {
      if (existsSync(path)) {
        try {
          const tempContent = readFileSync(path, 'utf8').trim();
          const tempMilliCelsius = parseInt(tempContent);
          if (!isNaN(tempMilliCelsius)) {
            return Math.round(tempMilliCelsius / 1000);
          }
        } catch (error) {
          continue;
        }
      }
    }

    return null;
  }

  /**
   * Unified macOS temperature monitoring
   */
  private getMacUnifiedTemperature(): number | null {
    try {
      // Try powermetrics (requires sudo, most accurate)
      const powerOutput = this.execCommand('sudo powermetrics --samplers smc -n 1 -i 1 2>/dev/null | grep -E "(CPU die temperature|CPU temperature)" | head -1');
      if (powerOutput && powerOutput !== 'N/A') {
        const tempMatch = powerOutput.match(/(\d+\.?\d*) °?C/);
        if (tempMatch) {
          return Math.round(parseFloat(tempMatch[1]));
        }
      }
    } catch (error) {
      // Continue to other methods
    }

    try {
      // Try osx-cpu-temp if available
      const osxTempOutput = this.execCommand('osx-cpu-temp 2>/dev/null');
      if (osxTempOutput && osxTempOutput !== 'N/A') {
        const tempMatch = osxTempOutput.match(/(\d+\.?\d*)°C/);
        if (tempMatch) {
          return Math.round(parseFloat(tempMatch[1]));
        }
      }
    } catch (error) {
      // Continue
    }

    return null;
  }

  /**
   * Unified Windows temperature monitoring
   */
  private getWindowsUnifiedTemperature(): number | null {
    try {
      // Try WMI thermal zone (most reliable)
      const wmiOutput = this.execCommand('wmic /namespace:\\\\root\\wmi PATH MSAcpi_ThermalZoneTemperature get CurrentTemperature /value 2>/dev/null');
      if (wmiOutput && wmiOutput !== 'N/A') {
        const match = wmiOutput.match(/CurrentTemperature=(\d+)/);
        if (match) {
          const tempKelvin = parseInt(match[1]);
          if (tempKelvin > 0) {
            const tempCelsius = (tempKelvin / 10) - 273.15;
            return Math.round(tempCelsius);
          }
        }
      }
    } catch (error) {
      // Continue to other methods
    }

    try {
      // Try OpenHardwareMonitor (if installed)
      const ohmOutput = this.execCommand('powershell -Command "Get-WmiObject -Namespace \'root\\OpenHardwareMonitor\' -Class \'Sensor\' | Where-Object {$_.SensorType -eq \'Temperature\' -and $_.Name -like \'*CPU*\'} | Select-Object -First 1 -ExpandProperty Value" 2>/dev/null');
      if (ohmOutput && ohmOutput !== 'N/A' && !isNaN(parseFloat(ohmOutput.trim()))) {
        return Math.round(parseFloat(ohmOutput.trim()));
      }
    } catch (error) {
      // Continue
    }

    return null;
  }

  /**
   * Get current resource usage (CPU, Memory, Disk, Temperature)
   */
  public getCurrentResourceUsage(): CurrentResourceUsage {
    try {
      const [cpuUsage, memoryUsage, diskUsage, temperature] = [
        this.getCpuUsage(),
        this.getMemoryUsage(),
        this.getDiskUsage(),
        this.getSystemTemperature()
      ];

      return {
        cpuUsage,
        memoryUsage,
        diskUsage,
        temperature
      };
    } catch (error) {
      // Return safe defaults if monitoring fails
      return {
        cpuUsage: 0,
        memoryUsage: 0,
        diskUsage: 0,
        temperature: 35
      };
    }
  }

  public getSystemSpecs(): SystemInfo {
    return {
      system: this.getSystemInfo(),
      cpu: this.getCpuInfo(),
      memory: this.getMemoryInfo(),
      storage: this.getStorageInfo(),
      gpu: this.getGpuInfo(),
      network: this.getNetworkInfo()
    };
  }
}
