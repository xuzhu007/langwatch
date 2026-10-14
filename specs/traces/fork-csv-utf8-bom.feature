Feature: CSV 导出带 UTF-8 BOM，Excel 打开中文不乱码
  作为在中文 Windows 上用 Excel 打开导出文件的自托管用户，
  我希望下载的 CSV 双击就能正确显示中文，
  这样不用每次手动把文件转成 UTF-8 BOM 编码。

  这是 fork 定制：上游的 CSV 都不带 BOM，Excel 会按系统 ANSI 编码（GBK）解析，中文因此乱码。
  覆盖 Trace Explorer 和 Scenario runs 的服务端流式导出，以及在浏览器里生成的 CSV 下载：
  数据集、标注、批量评测、审计日志（共用 downloadCsv）、Experiments 结果、Gateway 用量。
  JSON/JSONL 导出不受影响。

  @integration
  Scenario: Trace Explorer 导出的 CSV 以 BOM 开头且只写一次
    Given Trace Explorer 的 CSV 导出分多批写出
    When 用户下载导出文件
    Then 文件以 UTF-8 BOM 开头
    And 之后的批次里不再出现 BOM

  @integration
  Scenario: Trace Explorer 没有匹配数据的 CSV 导出仍是 0 字节
    Given 当前筛选条件下没有任何 trace
    When 用户导出 CSV
    Then 响应体是 0 字节，页面仍能提示没有可导出的数据

  @integration
  Scenario: Trace Explorer 导出的 JSONL 不加 BOM
    Given 用户选择 JSON 格式导出
    When 用户下载导出文件
    Then 文件第一行就是第一条 JSON 记录

  @integration
  Scenario: Scenario runs 导出的 CSV 解压后以 BOM 开头
    Given 用户有权限导出项目的 scenario runs
    When 用户下载 CSV
    Then 浏览器解压后的文件以 UTF-8 BOM 开头

  @unit
  Scenario: 浏览器生成的 CSV 下载以 BOM 开头且中文完整
    Given 一张包含中文的表格
    When 用户把它下载为 CSV
    Then 文件以 UTF-8 BOM 开头
    And 按 UTF-8 解码后中文内容完整

  @unit
  Scenario: Experiments 结果导出的 CSV 以 BOM 开头
    Given 一次包含中文数据集内容的实验运行
    When 用户导出结果为 CSV
    Then 文件以 UTF-8 BOM 开头

  @integration
  Scenario: Gateway 用量导出的 CSV 以 BOM 开头
    Given 用户在 Gateway 用量页
    When 用户点击 "Export CSV"
    Then 文件以 UTF-8 BOM 开头

  @unit
  Scenario: 带 BOM 的 CSV 上传为数据集时首列名不带 BOM
    Given 一个以 UTF-8 BOM 开头的 CSV 文件，例如本系统导出的文件或 Excel 另存的 "CSV UTF-8"
    And 用户在确认列时把首列设为数字类型
    When 数据集完成处理
    Then 首列名称不带 BOM
    And 首列按用户确认的类型转换
