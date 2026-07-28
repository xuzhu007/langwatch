import { sharedFiltersInputSchema } from "../../../analytics/types";
import { getAnalyticsService } from "../../../app-layer/analytics";
import { checkProjectPermission } from "../../rbac";
import { protectedProcedure } from "../../trpc";

// getFeedbacks 使用 projectId、时间窗口、filters 与 negateFilters。
// 其余字段仅为保持完整请求 schema 的 API 兼容性。
// query 与 traceIds 仅为保持 API 兼容而接收。
export const feedbacks = protectedProcedure
  .input(sharedFiltersInputSchema)
  .use(checkProjectPermission("cost:view"))
  .query(async ({ input }) => {
    const analyticsService = getAnalyticsService();
    return analyticsService.getFeedbacks(
      input.projectId,
      input.startDate,
      input.endDate,
      input.filters,
      input.negateFilters,
    );
  });
