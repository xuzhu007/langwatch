Feature: MCP 容器验证如实报告构建与启动结果
  容器测试从仓库工作区构建镜像，不能将准备失败报告为通过。

  @integration
  Scenario: 镜像包含工作区补丁并正常启动
    Given Docker 可用且仓库包含锁文件引用的补丁
    When 构建并启动 MCP 镜像
    Then 健康端点返回成功

  @unit
  Scenario: Docker 不可用时明确跳过容器测试
    Given Docker 守护进程不可用
    When 检测容器测试的运行条件
    Then 容器测试被标记为跳过而不是通过

  @unit
  Scenario: 镜像构建失败时测试失败
    Given Docker 可用
    When 镜像构建失败
    Then 准备过程向测试运行器抛出错误

  @unit
  Scenario: 容器启动失败时测试失败
    Given 镜像构建成功
    When 容器无法启动或健康检查持续失败
    Then 准备过程向测试运行器抛出错误
