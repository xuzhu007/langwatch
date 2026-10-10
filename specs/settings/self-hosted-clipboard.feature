Feature: 自托管页面的剪贴板兼容性
  自托管用户需要在 HTTP 页面复制恢复码和配置值，
  即使浏览器不提供现代剪贴板接口，也可以复制并看到准确反馈。

  @integration @regression
  Scenario: HTTP 页面可以复制恢复码和配置值
    Given 用户通过 HTTP 打开恢复码面板或配置值列表
    And 浏览器未提供现代剪贴板接口
    When 用户点击复制按钮
    Then 页面通过兼容方式复制完整内容并提示成功

  @integration
  Scenario: 安全上下文优先使用现代剪贴板接口
    Given 用户打开恢复码面板或配置值列表
    And 浏览器支持现代剪贴板接口
    When 用户点击复制按钮
    Then 页面使用现代接口复制完整内容并提示成功

  @integration @regression
  Scenario: 现代剪贴板接口拒绝时继续尝试兼容方式
    Given 用户打开恢复码面板或配置值列表
    And 浏览器拒绝现代剪贴板请求
    When 用户点击复制按钮
    Then 页面通过兼容方式复制完整内容并提示成功

  @integration @regression
  Scenario: 所有复制方式失败时提示手动复制
    Given 用户打开恢复码面板或配置值列表
    And 浏览器未提供现代剪贴板接口
    And 兼容复制方式也失败
    When 用户点击复制按钮
    Then 页面提示手动复制且不提示成功

  @integration @regression
  Scenario: HTTP 页面点击配置值行也可以复制
    Given 用户通过 HTTP 打开配置值列表
    And 浏览器未提供现代剪贴板接口
    When 用户点击配置值所在行
    Then 页面通过兼容方式复制该值并提示成功
