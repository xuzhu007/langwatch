/**
 * @vitest-environment jsdom
 *
 * “添加到数据集”批量选择的回归测试。
 *
 * 抽屉状态以逗号分隔数组保存在 URL 中，而 qs.parse 默认的 arrayLimit 为 20：
 * 选择超过 20 条 trace 后，`drawer.selectedTraceIds` 曾被解析为按索引编号的对象，
 * 而不是数组。添加到数据集抽屉随后把该对象传给 trace 查询，导致 zod 拒绝请求，
 * 映射预览无法渲染。本测试使用包含 100 个 ID 的 URL 渲染真实 CurrentDrawer，
 * 并断言抽屉组件收到普通字符串数组。
 * 参见 specs/datasets/add-to-dataset-span-mapping.feature。
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const TRACE_IDS = Array.from({ length: 100 }, (_, i) => `trace-${i + 1}`);

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    asPath: `/test-project/messages?drawer.open=addDatasetRecord&drawer.selectedTraceIds=${TRACE_IDS.join(",")}`,
    pathname: "/[project]/messages",
    query: {},
    push: vi.fn(),
    replace: vi.fn(),
  }),
  default: {
    push: vi.fn(),
    replace: vi.fn(),
    events: { on: vi.fn(), off: vi.fn() },
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ organizationRole: "ADMIN" }),
}));

vi.mock("~/components/drawerRegistry", () => ({
  drawers: {
    addDatasetRecord: (props: Record<string, unknown>) => (
      <div
        data-testid="drawer-probe"
        data-selected-trace-ids={JSON.stringify(props.selectedTraceIds)}
      />
    ),
  },
}));

const { CurrentDrawer } = await import("~/components/CurrentDrawer");

describe("CurrentDrawer bulk trace selection", () => {
  afterEach(() => cleanup());

  describe("when one hundred traces are selected", () => {
    /** @scenario 批量选择一百条 trace 后仍能打开预览 */
    it("hands the drawer every selected trace id as a string array", () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <CurrentDrawer />
        </ChakraProvider>,
      );

      const probe = screen.getByTestId("drawer-probe");
      const ids: unknown = JSON.parse(
        probe.getAttribute("data-selected-trace-ids")!,
      );
      expect(Array.isArray(ids)).toBe(true);
      expect(ids).toEqual(TRACE_IDS);
    });
  });
});
