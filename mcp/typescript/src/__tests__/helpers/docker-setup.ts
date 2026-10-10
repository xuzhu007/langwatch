import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function isDockerAvailable(): boolean {
  try {
    execFileSync("docker", ["info"], { stdio: "pipe", timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

export function removeDockerContainer(containerName: string): void {
  try {
    execFileSync("docker", ["rm", "-f", containerName], { stdio: "pipe" });
  } catch {
    // 清理不存在的容器不应覆盖原始构建或启动错误。
  }
}

export async function startDockerContainer({
  imageName,
  containerName,
  hostPort,
}: {
  imageName: string;
  containerName: string;
  hostPort: number;
}): Promise<void> {
  const repoRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
  execFileSync(
    "docker",
    ["build", "-t", imageName, "-f", "mcp/typescript/Dockerfile", "."],
    { cwd: repoRoot, stdio: "pipe", timeout: 240_000 }
  );
  removeDockerContainer(containerName);
  execFileSync(
    "docker",
    ["run", "-d", "--name", containerName, "-p", `${hostPort}:3000`, imageName],
    { stdio: "pipe" }
  );

  for (let retries = 0; retries < 20; retries++) {
    try {
      const response = await fetch(`http://localhost:${hostPort}/health`);
      if (response.ok) return;
    } catch {
      // 容器尚未准备好，继续有限次数重试。
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const logs = execFileSync("docker", ["logs", containerName], {
    encoding: "utf8",
  });
  throw new Error(`容器启动失败。日志：\n${logs}`);
}
