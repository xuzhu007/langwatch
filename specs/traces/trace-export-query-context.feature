Feature: 导出保留追踪浏览器的查询上下文
  导出使用页面当前查询对应的评估结果和来源范围，不重新发起付费评估。

  @integration @regression
  Scenario: 导出携带当前即时评估结果引用
    Given 当前查询含即时评估条件且已有评估结果
    When 用户导出当前追踪列表
    Then 下载请求携带该条件对应的问题、目标和运行 ID
    And 保留当前筛选表达式和时间范围

  @unit @regression
  Scenario: 导出用项目内已验证的即时评估结果筛选
    Given 导出请求携带即时评估结果引用
    When 服务端处理导出请求
    Then 先按当前项目验证该运行
    And 计数与每批导出使用同一份评估结果筛选条件
    And 不发起新的评估调用

  @unit @regression
  Scenario: 导出保留浏览器默认隐藏的来源范围
    Given 当前查询没有显式指定来源
    When 用户导出全部匹配追踪
    Then 导出与列表一样排除 Langy 自身追踪
    But 显式指定来源时保留用户选择
