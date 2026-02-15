/**
 * GPU detection for Windows (nvidia-smi), macOS (system_profiler), and Linux (nvidia-smi / lspci).
 * Detects VRAM capacity for intelligent model routing decisions.
 */

import { execSync } from "node:child_process";
import { platform } from "node:os";

export type GpuInfo = {
  name: string;
  vendor: "NVIDIA" | "AMD" | "Apple" | "Unknown";
  vramMB: number;
  vramBytes: number;
  driverVersion?: string;
};

export type SystemMemory = {
  totalMB: number;
  freeMB: number;
  totalBytes: number;
  freeBytes: number;
};

function tryExec(cmd: string): string | null {
  try {
    return execSync(cmd, { encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
}

/**
 * Detect discrete GPUs and their VRAM.
 */
export function detectGpus(): GpuInfo[] {
  const gpus: GpuInfo[] = [];
  const os = platform();

  if (os === "win32" || os === "linux") {
    // Try nvidia-smi first
    const nvOut = tryExec(
      "nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader,nounits"
    );
    if (nvOut) {
      for (const line of nvOut.split("\n")) {
        const parts = line.split(",").map((p) => p.trim());
        if (parts.length >= 2) {
          const vramMB = parseInt(parts[1], 10) || 0;
          gpus.push({
            name: parts[0],
            vendor: "NVIDIA",
            vramMB,
            vramBytes: vramMB * 1024 * 1024,
            driverVersion: parts[2] || undefined,
          });
        }
      }
    }

    // Try AMD on Linux
    if (os === "linux" && gpus.length === 0) {
      const amdOut = tryExec("rocm-smi --showmeminfo vram --csv 2>/dev/null");
      if (amdOut) {
        const lines = amdOut.split("\n").filter((l) => l.includes("Total"));
        for (const line of lines) {
          const match = line.match(/(\d+)/);
          if (match) {
            const vramMB = Math.round(parseInt(match[1], 10) / 1024 / 1024);
            gpus.push({
              name: "AMD GPU",
              vendor: "AMD",
              vramMB,
              vramBytes: vramMB * 1024 * 1024,
            });
          }
        }
      }
    }
  } else if (os === "darwin") {
    // macOS: check for Apple Silicon unified memory or discrete GPU
    const spOut = tryExec(
      "system_profiler SPDisplaysDataType 2>/dev/null"
    );
    if (spOut) {
      const chipMatch = spOut.match(/Chipset Model:\s*(.+)/i);
      const vramMatch = spOut.match(/VRAM.*?:\s*(\d+)\s*(MB|GB)/i);
      if (chipMatch) {
        let vramMB = 0;
        if (vramMatch) {
          vramMB = parseInt(vramMatch[1], 10);
          if (vramMatch[2].toUpperCase() === "GB") vramMB *= 1024;
        }
        const name = chipMatch[1].trim();
        const vendor = name.includes("Apple")
          ? "Apple" as const
          : name.match(/NVIDIA|GeForce|RTX|GTX/)
            ? "NVIDIA" as const
            : name.match(/AMD|Radeon/)
              ? "AMD" as const
              : "Unknown" as const;

        gpus.push({ name, vendor, vramMB, vramBytes: vramMB * 1024 * 1024 });
      }
    }
  }

  return gpus;
}

/**
 * Get system memory info.
 */
export function getSystemMemory(): SystemMemory {
  const os = platform();
  let totalMB = 0;
  let freeMB = 0;

  if (os === "win32") {
    const wmicOut = tryExec(
      'wmic OS get TotalVisibleMemorySize,FreePhysicalMemory /VALUE'
    );
    if (wmicOut) {
      const totalMatch = wmicOut.match(/TotalVisibleMemorySize=(\d+)/);
      const freeMatch = wmicOut.match(/FreePhysicalMemory=(\d+)/);
      if (totalMatch) totalMB = Math.round(parseInt(totalMatch[1], 10) / 1024);
      if (freeMatch) freeMB = Math.round(parseInt(freeMatch[1], 10) / 1024);
    }
  } else {
    // Linux / macOS
    const memOut = tryExec("free -m 2>/dev/null");
    if (memOut) {
      const memLine = memOut.split("\n").find((l) => l.startsWith("Mem:"));
      if (memLine) {
        const parts = memLine.split(/\s+/);
        totalMB = parseInt(parts[1], 10) || 0;
        freeMB = parseInt(parts[6] ?? parts[3], 10) || 0; // available or free
      }
    } else {
      // macOS fallback
      const sysctl = tryExec("sysctl -n hw.memsize 2>/dev/null");
      if (sysctl) {
        totalMB = Math.round(parseInt(sysctl, 10) / 1024 / 1024);
      }
      const vmStat = tryExec("vm_stat 2>/dev/null");
      if (vmStat) {
        const freePages = vmStat.match(/Pages free:\s+(\d+)/);
        const inactivePages = vmStat.match(/Pages inactive:\s+(\d+)/);
        const pageSize = 4096;
        const free = parseInt(freePages?.[1] ?? "0", 10) * pageSize;
        const inactive = parseInt(inactivePages?.[1] ?? "0", 10) * pageSize;
        freeMB = Math.round((free + inactive) / 1024 / 1024);
      }
    }
  }

  return {
    totalMB,
    freeMB,
    totalBytes: totalMB * 1024 * 1024,
    freeBytes: freeMB * 1024 * 1024,
  };
}

/**
 * Get NVIDIA GPU utilization percentage (0-100).
 * Returns null if nvidia-smi is unavailable.
 */
export function getNvidiaGpuUtilization(): number | null {
  const out = tryExec(
    "nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits"
  );
  if (!out) return null;
  const val = parseInt(out.split("\n")[0].trim(), 10);
  return isNaN(val) ? null : val;
}

/**
 * Get NVIDIA VRAM usage in MB.
 */
export function getNvidiaVramUsage(): { usedMB: number; totalMB: number } | null {
  const out = tryExec(
    "nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits"
  );
  if (!out) return null;
  const parts = out.split("\n")[0].split(",").map((p) => parseInt(p.trim(), 10));
  if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return null;
  return { usedMB: parts[0], totalMB: parts[1] };
}
