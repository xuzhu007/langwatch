import { z } from "zod";
import { INSTANT_EVAL_TARGETS } from "~/server/app-layer/instant-evals/shorthand";

/** 列表和导出接受同一组即时评估引用；运行所属项目仍由服务端校验。 */
export const evalRunsSchema = z
  .record(
    z.string().min(1).max(64),
    z.object({
      question: z.string().min(1).max(2_000),
      target: z.enum(INSTANT_EVAL_TARGETS),
      runId: z.string().min(1).max(200),
    }),
  )
  .refine((runs) => Object.keys(runs).length <= 8, {
    message: "一次查询最多可引用八个即时评估运行。",
  })
  .optional();
