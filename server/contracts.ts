import { z } from 'zod';
export const delegationSchema = z
  .object({
    assistant_id: z.enum(['researcher', 'writer', 'coder']),
    goal: z.string().trim().min(1).max(8000),
    input: z.string().trim().min(1).max(12000),
    file_ids: z.array(z.string().min(1)).max(30),
    deliverable: z.string().trim().min(1).max(2000),
    criteria: z.array(z.string().trim().min(1).max(1000)).min(1).max(10),
    dependencies: z.array(z.string().min(1)).max(3),
  })
  .strict();
export const reviewSchema = z
  .object({
    task_id: z.string().min(1),
    decision: z.enum(['adopted', 'rejected']),
    reason: z.string().trim().min(1).max(2000),
    checks: z
      .array(
        z
          .object({
            index: z.number().int().min(0),
            passed: z.boolean(),
            evidence: z.string().trim().min(1).max(2000),
          })
          .strict(),
      )
      .min(1)
      .max(10),
  })
  .strict();
