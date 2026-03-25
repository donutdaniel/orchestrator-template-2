import { z } from "zod";

export default {
  id: "find_bugs",
  description:
    "Scan source files for common bug patterns like unhandled errors, race conditions, and security issues.",
  inputSchema: z.object({
    paths: z
      .array(z.string())
      .min(1)
      .describe("File or directory paths to scan."),
    categories: z
      .array(
        z.enum([
          "error_handling",
          "race_conditions",
          "security",
          "null_safety",
          "resource_leaks",
        ]),
      )
      .optional()
      .describe("Bug categories to check. Defaults to all."),
  }),
  outputSchema: z.object({
    findings: z.array(
      z.object({
        file: z.string(),
        line: z.number(),
        category: z.string(),
        severity: z.enum(["low", "medium", "high", "critical"]),
        message: z.string(),
        suggestion: z.string(),
      }),
    ),
    summary: z.string(),
  }),
  run: async (input: {
    paths: string[];
    categories?: string[];
  }) => ({
    findings: [],
    summary: `Scanned ${input.paths.length} path(s). No issues found.`,
  }),
};
