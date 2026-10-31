Feature: 上游同步使用拉取请求的实际目标提交
  作为维护叠加拉取请求的开发者
  我希望应用构建范围以实际 PR 目标提交计算
  从而避免把父分支的升级内容误算进当前变更

  @integration
  Scenario: Git 和 Nx 使用相同的 PR 目标 SHA
    Given 拉取请求的目标是 main 或升级分支
    When 工作流计算受影响的应用
    Then Git diff 和 Nx affected 使用 github.event.pull_request.base.sha

  @integration
  Scenario: 范围检测失败时构建所有应用
    Given Nx affected 返回非零状态
    When 工作流执行 guard 步骤
    Then API、worker 和 UI 都保留在构建范围内

  @integration
  Scenario: 上游同步草稿执行完整验证
    Given 草稿拉取请求带有 upstream-sync 标签
    When 工作流选择验证范围
    Then 启用完整验证分支
