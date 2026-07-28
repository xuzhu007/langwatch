import { Instance, Ksuid, MAX_TIMESTAMP, Node, parse } from "@langwatch/ksuid";
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

  it("stays k-sorted across the previous 16-bit timestamp boundary", () => {
    const before = new Ksuid("prod", "view", 1_700_003_839, INSTANCE, 0);
    const after = new Ksuid("prod", "view", 1_700_003_840, INSTANCE, 0);

    expect(before.toString() < after.toString()).toBe(true);
    expect(parse(before.toString()).timestamp).toBe(before.timestamp);
    expect(parse(after.toString()).timestamp).toBe(after.timestamp);
  });
  it("preserves timestamps from ids emitted by the original 2.0.2 encoder", () => {
    const parsed = parse("view_0008qTHxTCVP6Ug6uv0OFLI3IekaG");

    expect(parsed.timestamp).toBe(1_700_003_839);
    expect(parsed.sequenceId).toBe(0);
    expect(parsed.instance.equals(INSTANCE)).toBe(true);
  });

  it.each([
    2_147_483_648,
    Number(MAX_TIMESTAMP),
  ])("round-trips the 48-bit timestamp boundary %s", (timestamp) => {
    const id = new Ksuid("prod", "view", timestamp, INSTANCE, 0xffffffff);

    const parsed = parse(id.toString());

    expect(parsed.timestamp).toBe(timestamp);
    expect(parsed.sequenceId).toBe(0xffffffff);
    expect(parsed.instance.equals(INSTANCE)).toBe(true);
  });
});
