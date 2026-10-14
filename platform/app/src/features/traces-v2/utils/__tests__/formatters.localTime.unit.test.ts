/**
 * Fork 定制：Trace Explorer 的绝对时间按浏览器本地时区显示（上游为 UTC），
 * 悬浮卡里明确标注的 UTC 一行保持 UTC。
 *
 * CI 运行在 UTC，本地格式和 UTC 格式在那里完全一致，所以这里先把进程
 * 时区固定到 Asia/Shanghai 再断言。
 *
 * @see specs/traces-v2/fork-local-time-display.feature
 */
// Through node:process, NOT the global: under a vm pool with isolate:false the
// `process` global wraps the real one and assigning TZ on it does not flush
// V8's cached timezone. See trace-analytics.clickhouse.repository.unit.test.ts.
import { env as nodeProcessEnv } from "node:process";

const ORIGINAL_TZ = nodeProcessEnv.TZ;
nodeProcessEnv.TZ = "Asia/Shanghai";

import { afterAll, describe, expect, it } from "vitest";
import { timeColumnSizing } from "../../stores/timeFormatStore";
import {
  formatAbsoluteTime,
  formatISOTimestamp,
  formatLocalWithZone,
} from "../formatters";

afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete nodeProcessEnv.TZ;
  else nodeProcessEnv.TZ = ORIGINAL_TZ;
});

const MORNING_UTC = Date.UTC(2026, 9, 14, 3, 0, 0, 123);

describe("Trace Explorer absolute times", () => {
  describe("given the browser is in Asia/Shanghai", () => {
    it("runs off UTC, so the assertions below are not vacuous", () => {
      expect(new Date(MORNING_UTC).getTimezoneOffset()).toBe(-480);
    });

    describe("when a timestamp renders in ISO format", () => {
      /** @scenario ISO 格式显示本地时间并带时区偏移 */
      it("spells the local wall-clock with the +08:00 offset", () => {
        expect(formatISOTimestamp(MORNING_UTC)).toBe(
          "2026-10-14T11:00:00.123+08:00",
        );
      });

      /** @scenario 跨过本地零点的时间按本地日期显示 */
      it("moves to the local calendar day past local midnight", () => {
        expect(formatISOTimestamp(Date.UTC(2026, 9, 14, 20, 30, 0))).toBe(
          "2026-10-15T04:30:00.000+08:00",
        );
      });

      it("denotes the same instant it was given", () => {
        expect(Date.parse(formatISOTimestamp(MORNING_UTC))).toBe(MORNING_UTC);
      });
    });

    describe("when a timestamp renders as a local time with its zone", () => {
      /** @scenario 抽屉头部和编辑记录的时间提示显示本地时间和时区标识 */
      it("spells the local wall-clock and names the zone", () => {
        const local = formatLocalWithZone(MORNING_UTC);

        expect(local.startsWith("2026-10-14 11:00:00 ")).toBe(true);
        expect(local.length).toBeGreaterThan("2026-10-14 11:00:00 ".length);
      });

      /** @scenario 本地零点显示为 00 点而不是 24 点 */
      it("renders local midnight as hour 00", () => {
        expect(
          formatLocalWithZone(Date.UTC(2026, 9, 13, 16, 5, 0)).startsWith(
            "2026-10-14 00:05:00",
          ),
        ).toBe(true);
      });
    });

    describe("when the hover card renders its UTC row", () => {
      /** @scenario 时间悬浮卡的 UTC 一行仍显示 UTC */
      it("keeps the UTC wall-clock and says so", () => {
        expect(formatAbsoluteTime(MORNING_UTC)).toBe("2026-10-14 03:00:00 UTC");
      });
    });
  });

  describe("given the Time column shows ISO", () => {
    /** @scenario ISO 格式的时间列足够宽，不截断时区偏移 */
    it("floors the column wide enough for the stamp with its offset", () => {
      // ~8px per monospace char at the table's font size is the floor the
      // upstream sizing test uses too.
      expect(timeColumnSizing("iso").minSize).toBeGreaterThanOrEqual(
        formatISOTimestamp(MORNING_UTC).length * 8,
      );
    });
  });
});
