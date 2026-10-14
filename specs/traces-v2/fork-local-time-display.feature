Feature: Trace Explorer 按浏览器本地时区显示时间
  作为在上海（UTC+8）的自托管用户，
  我希望 Trace Explorer 里的绝对时间直接显示为本地时间，
  这样不用每次手动加 8 小时才能对上自己的时间。

  这是 fork 定制：上游 Trace Explorer 的 ISO 格式、Timestamp 列和抽屉头部的时间提示都按 UTC 显示。
  时间悬浮卡仍保留明确标注为 UTC 的一行，方便对照服务端日志。

  @unit
  Scenario: ISO 格式显示本地时间并带时区偏移
    Given 浏览器时区为 Asia/Shanghai
    When 以 ISO 格式显示 UTC 时间 2026-10-14 03:00:00.123 的 trace
    Then 显示 "2026-10-14T11:00:00.123+08:00"

  @unit
  Scenario: 跨过本地零点的时间按本地日期显示
    Given 浏览器时区为 Asia/Shanghai
    When 以 ISO 格式显示 UTC 时间 2026-10-14 20:30:00 的 trace
    Then 显示 "2026-10-15T04:30:00.000+08:00"

  @unit
  Scenario: 抽屉头部和编辑记录的时间提示显示本地时间和时区标识
    Given 浏览器时区为 Asia/Shanghai
    When 用户悬停在 trace 抽屉头部的相对时间或“Edited by”上
    Then 提示显示 "2026-10-14 11:00:00" 以及本地时区标识

  @unit
  Scenario: 本地零点显示为 00 点而不是 24 点
    Given 浏览器时区为 Asia/Shanghai
    When 显示本地时间 2026-10-14 00:05:00 的 trace
    Then 提示显示 "2026-10-14 00:05:00"

  @unit
  Scenario: 时间悬浮卡的 UTC 一行仍显示 UTC
    Given 浏览器时区为 Asia/Shanghai
    When 用户悬停在列表的时间上
    Then UTC 一行显示 "2026-10-14 03:00:00 UTC"

  @unit
  Scenario: ISO 格式的时间列足够宽，不截断时区偏移
    Given 用户把 Time 列切换为 ISO 格式
    Then 列的最小宽度能完整容纳带时区偏移的 ISO 时间
