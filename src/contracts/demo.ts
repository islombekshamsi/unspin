import { z } from "zod";
import { IdSchema } from "./common";
import { SelectionEventSchema } from "./chart";
export const DemoModeSchema = z.enum(["finance", "academic", "research"]);
export type DemoMode = z.infer<typeof DemoModeSchema>;
export const PrepareDemoRequestSchema = z.object({ mode: DemoModeSchema });
export const PreparedDemoReportSchema = z.object({
  mode: DemoModeSchema, title: z.string(), scope: z.string(), limitations: z.array(z.string()),
  datasets: z.array(z.object({ id: IdSchema, title: z.string(), key: z.string(), versionId: IdSchema,
    chart: z.object({ xColumnId: IdSchema, yColumnIds: z.array(IdSchema), kind: z.enum(["bar", "line", "scatter"]) }),
  })),
  insights: z.array(z.object({ title: z.string(), text: z.string(), datasetId: IdSchema, evidence: SelectionEventSchema })),
});
export type PreparedDemoReport = z.infer<typeof PreparedDemoReportSchema>;
