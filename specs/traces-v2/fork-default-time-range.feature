Feature: 自托管默认查询最近 7 天
  作为自托管团队的成员，
  我希望 Trace Explorer、Analytics 等页面在没有选择时间范围时默认查询最近 7 天，
  这样页面打开更快，看到的也是最常用的时间窗口。

  这是 fork 定制：上游默认 30 天。
  Simulations、Agent Testing、审计日志等显式指定 30 天的页面保持 30 天不变。
  已经通过链接或选择器明确选过的时间范围不受影响。

  @unit
  Scenario: Trace Explorer 默认时间窗口为最近 7 天
    Given 用户第一次打开 Trace Explorer
    When 用户没有选择过时间范围
    Then 时间范围选择器显示 "Last 7 days"
    And 列表只查询最近 7 天的 trace

  @unit
  Scenario: 不带时间参数的 Explorer 历史记录恢复为最近 7 天
    Given 用户在 Trace Explorer 中把时间范围改成了最近 30 天
    When 用户通过浏览器后退回到一条不带时间参数的历史记录
    Then 时间范围恢复为最近 7 天

  @unit
  Scenario: 没有打开 Explorer 页面时 Langy 按最近 7 天回答默认状态
    Given 没有打开的 Trace Explorer 页面
    When Langy 读取 Explorer 的默认状态
    Then 回答的时间范围是最近 7 天
    And 生成的 Explorer 链接不带时间参数

  @unit
  Scenario: 选择最近 30 天的 Explorer 链接显式带上时间范围
    Given 用户或 Langy 把 Explorer 的时间范围设为最近 30 天
    When 生成 Explorer 链接
    Then 链接中带有 "preset=30d"

  @unit
  Scenario: Analytics 等页面未选择时间时默认最近 7 天
    Given 用户打开 Analytics、Dashboard 或首页
    When 地址栏里没有时间范围参数
    Then 查询窗口为包含今天在内的最近 7 天
    And 页面把这个窗口当作默认值

  @unit
  Scenario: 显式指定 30 天的页面仍默认最近 30 天
    Given 用户打开 Simulations、Agent Testing 或审计日志页面
    When 地址栏里没有时间范围参数
    Then 查询窗口仍为包含今天在内的最近 30 天
