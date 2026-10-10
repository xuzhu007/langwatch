import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isDockerAvailable, startDockerContainer } from "./helpers/docker-setup";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));

const options = {
  imageName: "mcp-test",
  containerName: "mcp-test-container",
  hostPort: 13099,
};

describe("当容器验证准备运行时", () => {
  beforeEach(() => {
    vi.mocked(execFileSync).mockReset().mockReturnValue("");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  // @scenario "Docker 不可用时明确跳过容器测试"
  it("将不可用的 Docker 报告为跳过条件", () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("Docker 不可用");
    });
    expect(isDockerAvailable()).toBe(false);
  });

  it("Docker 可用时不跳过验证", () => {
    expect(isDockerAvailable()).toBe(true);
  });

  it("从测试文件所在仓库构建并等待健康端点", async () => {
    await startDockerContainer(options);
    const buildCall = vi.mocked(execFileSync).mock.calls[0]!;
    const cwd = buildCall[2]!.cwd as string;
    expect(existsSync(`${cwd}/mcp/typescript/Dockerfile`)).toBe(true);
    expect(existsSync(`${cwd}/patches/@langwatch__ksuid@2.0.2.patch`)).toBe(true);
    expect(buildCall[1]).toEqual([
      "build",
      "-t",
      options.imageName,
      "-f",
      "mcp/typescript/Dockerfile",
      ".",
    ]);
    expect(fetch).toHaveBeenCalledWith(`http://localhost:${options.hostPort}/health`);
  });

  // @scenario "镜像构建失败时测试失败"
  it("传播镜像构建失败而不是继续执行断言", async () => {
    const error = new Error("镜像构建失败");
    vi.mocked(execFileSync).mockImplementationOnce(() => {
      throw error;
    });
    await expect(startDockerContainer(options)).rejects.toBe(error);
    expect(fetch).not.toHaveBeenCalled();
  });

  // @scenario "容器启动失败时测试失败"
  it("传播容器启动失败", async () => {
    const error = new Error("容器启动失败");
    vi.mocked(execFileSync).mockImplementation((_command, args) => {
      if (args?.[0] === "run") throw error;
      return "";
    });
    await expect(startDockerContainer(options)).rejects.toBe(error);
  });

  it("健康检查持续失败时提供日志并失败", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockRejectedValue(new Error("连接被拒绝"));
    vi.mocked(execFileSync).mockReturnValue("启动错误日志");
    const assertion = expect(startDockerContainer(options)).rejects.toThrow(
      "启动错误日志"
    );
    await vi.runAllTimersAsync();
    await assertion;
  });
});
