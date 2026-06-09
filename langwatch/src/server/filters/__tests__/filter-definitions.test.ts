import { describe, expect, it } from "vitest";
import { clickHouseFilters } from "../clickhouse/filter-definitions";
import type { ClickHouseFilterQueryParams } from "../clickhouse/types";

describe("clickHouseFilters", () => {
  const baseParams: ClickHouseFilterQueryParams = {
    tenantId: "test-project",
    startDate: 0,
    endDate: 1000,
  };

  describe("events.event_type", () => {
    it("reads event names from the stored_spans Events.Name array", () => {
      const def = clickHouseFilters["events.event_type"];
      expect(def).not.toBeNull();
      const sql = def!.buildQuery(baseParams);

      expect(sql).toContain("arrayJoin(");
      expect(sql).toContain("Events.Name");
      expect(sql).toContain("FROM stored_spans");
      // The dropdown must not read from the (unpopulated) span attribute anymore;
      // events are stored as OTel span events in the Events.Name array.
      expect(sql).not.toContain("SpanAttributes['event.type']");
    });

    it("filters by the search query against the event name", () => {
      const def = clickHouseFilters["events.event_type"];
      const sql = def!.buildQuery({ ...baseParams, query: "thumbs" });

      expect(sql).toContain("lower(name) LIKE lower(concat({query:String}, '%'))");
    });

    it("scopes results to other filters via a trace_summaries join", () => {
      const def = clickHouseFilters["events.event_type"];
      const sql = def!.buildQuery({
        ...baseParams,
        scopeFilters: { "topics.topics": ["topic-1"] },
      });

      expect(sql).toContain("FROM trace_summaries ts");
    });
  });
});
