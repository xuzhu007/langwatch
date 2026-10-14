/**
 * Fork 定制：Trace Explorer 以及 Langy 回答的 Explorer 默认状态都是最近 7 天
 * （上游为 30 天）。选择了其他窗口的链接仍要显式带上 preset，否则打开后会
 * 被当作默认窗口。
 *
 * @see specs/traces-v2/fork-default-time-range.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultExplorerState,
  explorerHrefFor,
} from "~/server/app-layer/langy/ui-actions/explorerBackendExecutor";
import { getPresetById } from "../../utils/timeRangePresets";
import { INITIAL_TIME_RANGE } from "../querySlice";

const NOW = Date.UTC(2026, 9, 14, 4, 0, 0);
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function presetQuery(href: string): string | null {
  const fragment = href.slice(href.indexOf("#") + 1);
  const query = fragment.split("?", 2)[1] ?? "";
  return new URLSearchParams(query).get("preset");
}

describe("Trace Explorer default time range", () => {
  describe("given the user has never picked a window", () => {
    describe("when the Explorer store starts", () => {
      /** @scenario Trace Explorer 默认时间窗口为最近 7 天 */
      it("holds the rolling last 7 days", () => {
        expect(INITIAL_TIME_RANGE.presetId).toBe("7d");
        expect(INITIAL_TIME_RANGE.label).toBe("Last 7 days");
        expect(INITIAL_TIME_RANGE.to - INITIAL_TIME_RANGE.from).toBe(
          SEVEN_DAYS_MS,
        );
      });
    });
  });

  describe("given no Explorer page is open", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    describe("when Langy reads the Explorer's defaults", () => {
      /** @scenario 没有打开 Explorer 页面时 Langy 按最近 7 天回答默认状态 */
      it("answers the last 7 days and a link without a preset", () => {
        const state = defaultExplorerState();

        expect(state.timeRange.presetId).toBe("7d");
        expect(state.timeRange.label).toBe("Last 7 days");
        expect(state.timeRange.from).toBe(NOW - SEVEN_DAYS_MS);
        expect(explorerHrefFor({ projectSlug: "acme", state })).toBe(
          "/acme/traces#all-traces",
        );
      });
    });

    describe("when a link is built for the last 30 days", () => {
      /** @scenario 选择最近 30 天的 Explorer 链接显式带上时间范围 */
      it("names the 30d preset in the fragment", () => {
        const preset = getPresetById("30d");
        if (!preset) throw new Error("the 30d preset went missing");

        const href = explorerHrefFor({
          projectSlug: "acme",
          state: {
            activeLensId: "all-traces",
            queryText: "",
            timeRange: {
              ...preset.compute(),
              label: preset.label,
              presetId: preset.id,
            },
          },
        });

        expect(presetQuery(href)).toBe("30d");
      });
    });
  });
});
