Feature: 未加引号的筛选值中包含冒号
  标签等取值本身常带冒号（如 "team:xiaohai-product-support-entry"）。
  查询语言只把第一个冒号当作字段分隔符，之后的冒号属于值本身，
  用户不必手动加引号，也不会再看到 "Syntax error at line 1 column 11"。

  @unit @regression
  Scenario: 未加引号的值中的冒号被视为值的一部分
    When 用户在 Trace Explorer 搜索 "label:team:xiaohai-product-support-entry"
    Then 查询被解析为字段 "label"、值 "team:xiaohai-product-support-entry"
    And 搜索栏中的筛选标签覆盖整个条件

  @unit @regression
  Scenario: 带冒号的未加引号值与加引号写法筛选结果一致
    When 用户搜索 "label:team:xiaohai-product-support-entry"
    Then ClickHouse 查询与 'label:"team:xiaohai-product-support-entry"' 相同
    And 内存匹配只命中带该标签的追踪

  @unit
  Scenario: 带冒号的值可与布尔运算、分组和通配符组合
    When 用户搜索 "(label:team:a OR label:team:b*) AND NOT status:error"
    Then 每个标签条件的值都保留冒号
    And 引号、范围和比较写法的解析结果不变
