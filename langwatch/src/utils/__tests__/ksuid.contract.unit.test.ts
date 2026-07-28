import { Instance, Ksuid, Node, parse } from "@langwatch/ksuid";
import { afterEach, describe, expect, it, vi } from "vitest";

const INSTANCE = new Instance(
  Instance.schemes.RANDOM,
  new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
);

function createNode(): Node {
  return new Node(
    "prod",
    INSTANCE,
    (environment, resource, timestamp, instance, sequenceId) =>
      new Ksuid(environment, resource, timestamp, instance, sequenceId),
  );
}

describe("@langwatch/ksuid contract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps generated ids unique and ordered when the clock moves backwards", () => {
    const node = createNode();
    const now = vi.spyOn(Date, "now");

    now.mockReturnValue(2_000_000_000_000);
    const first = node.generate("probe");
    now.mockReturnValue(2_000_000_001_000);
    const second = node.generate("probe");
    now.mockReturnValue(2_000_000_000_000);
    const afterRollback = node.generate("probe");

    const ids = [first.toString(), second.toString(), afterRollback.toString()];
    expect(new Set(ids)).toHaveLength(3);
    expect(ids).toEqual([...ids].sort());
    expect(afterRollback.timestamp).toBe(second.timestamp);
    expect(afterRollback.sequenceId).toBe(second.sequenceId + 1);
  });

  it("advances the logical second when the sequence is exhausted", () => {
    const node = createNode();
    vi.spyOn(Date, "now").mockReturnValue(2_000_000_000_000);
    const first = node.generate("probe");
    const state = node as unknown as {
      _lastTimestamp: number;
      _currentSequence: number;
    };
    state._currentSequence = 0xffffffff;

    const afterOverflow = node.generate("probe");

    expect(afterOverflow.timestamp).toBe(first.timestamp + 1);
    expect(afterOverflow.sequenceId).toBe(0);
    expect(first.toString() < afterOverflow.toString()).toBe(true);
  });

  it("preserves the original 2.0.2 wire format", () => {
    const historicalId = "view_0008qTHxTCVP6Ug6uv0OFLI3IekaG";
    const recreated = new Ksuid("prod", "view", 1_700_003_839, INSTANCE, 0);

    expect(recreated.toString()).toBe(historicalId);
    expect(parse(historicalId).toString()).toBe(historicalId);
  });
});
