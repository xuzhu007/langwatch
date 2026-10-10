Feature: 追踪筛选中的复合否定
  用户否定一组筛选条件时，查询与自动化都遵守相同的布尔语义。

  @unit @regression
  Scenario: 否定条件组遵守德摩根定律
    Given 项目包含 application、sample 和 langy 来源的追踪
    When 用户否定通过 AND 或 OR 组合的来源条件
    Then ClickHouse 查询和内存匹配都按整个条件组取反
    And 双重否定恢复原条件组的含义
