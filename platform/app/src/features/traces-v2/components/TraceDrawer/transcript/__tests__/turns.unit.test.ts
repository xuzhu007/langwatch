import { describe, expect, it } from "vitest";
import { normalizeToolCalls } from "../parsing";
import { groupMessagesIntoTurns, summarizeTurn } from "../turns";
import type { ChatMessage } from "../types";

const openAIToolCall = {
  id: "call_1",
  type: "function",
  function: { name: "get_weather", arguments: '{"city":"hz"}' },
};

describe("normalizeToolCalls", () => {
  it("保留标准 OpenAI 数组形状", () => {
    expect(normalizeToolCalls([openAIToolCall])).toEqual([openAIToolCall]);
  });

  it("解析字符串化 JSON 的 tool_calls（埋点/网关 stringify 上报）", () => {
    expect(normalizeToolCalls(JSON.stringify([openAIToolCall]))).toEqual([
      openAIToolCall,
    ]);
  });

  it("把单个 tool_call 对象包成数组", () => {
    expect(normalizeToolCalls(openAIToolCall)).toEqual([openAIToolCall]);
  });

  it("归一化扁平 {name, arguments} 形状", () => {
    expect(
      normalizeToolCalls([{ name: "search", arguments: '{"q":"x"}' }]),
    ).toEqual([
      {
        function: { name: "search", arguments: '{"q":"x"}' },
        id: "",
        type: "function",
      },
    ]);
  });

  it("arguments 为对象时字符串化，保证下游 JSON.parse 可用", () => {
    const calls = normalizeToolCalls([
      { function: { name: "search", arguments: { q: "x" } } },
    ]);
    expect(calls?.[0]?.function.arguments).toBe('{"q":"x"}');
  });

  it("丢弃无法辨认的项，全部丢弃时返回 undefined", () => {
    expect(normalizeToolCalls(42)).toBeUndefined();
    expect(normalizeToolCalls("not json")).toBeUndefined();
    expect(normalizeToolCalls([null, 1, {}])).toBeUndefined();
    expect(normalizeToolCalls(undefined)).toBeUndefined();
    expect(normalizeToolCalls(null)).toBeUndefined();
  });
});

describe("groupMessagesIntoTurns", () => {
  it("tool_calls 为字符串化 JSON 时不再抛 not iterable（回归）", () => {
    const messages = [
      { role: "user", content: "查下杭州天气" },
      {
        role: "assistant",
        content: null,
        // 线上崩溃形状：tool_calls 是 JSON 字符串而非数组
        tool_calls: JSON.stringify([openAIToolCall]),
      },
    ] as unknown as ChatMessage[];

    const turns = groupMessagesIntoTurns(messages);

    expect(turns).toHaveLength(2);
    const assistant = turns[1]!;
    expect(assistant.kind).toBe("assistant");
    if (assistant.kind === "assistant") {
      expect(assistant.toolCalls).toEqual([openAIToolCall]);
      expect(summarizeTurn(assistant)).toBe("Tool · get_weather");
    }
  });

  it("tool_calls 为垃圾值时按无 tool_calls 处理", () => {
    const messages = [
      { role: "assistant", content: "ok", tool_calls: 42 },
    ] as unknown as ChatMessage[];

    const turns = groupMessagesIntoTurns(messages);

    expect(turns).toHaveLength(1);
    if (turns[0]!.kind === "assistant") {
      expect(turns[0]!.toolCalls).toEqual([]);
    }
  });

  it("标准数组形状行为不变", () => {
    const messages: ChatMessage[] = [
      { role: "assistant", content: null, tool_calls: [openAIToolCall] },
    ];

    const turns = groupMessagesIntoTurns(messages);

    expect(turns).toHaveLength(1);
    if (turns[0]!.kind === "assistant") {
      expect(turns[0]!.toolCalls).toEqual([openAIToolCall]);
    }
  });
});
