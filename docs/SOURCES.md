# Sources and implementation reading

These links ground the brief. Current library/API details must be checked by the implementing agent before use. Accessed during planning on October 24, 2026 unless otherwise noted. An available source does not grant permission to process every document it mentions.

## Event and agent execution

- HackPSU Fall 2026 categories and judging: https://hackpsu-fall-2026.devpost.com/
- HackPSU project rules: https://hackpsu-fall-2026.devpost.com/rules
- Cursor worktrees: https://cursor.com/docs/configuration/worktrees
- Cursor subagents: https://cursor.com/docs/subagents

Cursor documents isolated worktree/cloud execution. Actual UI/features and secret availability depend on the installed version and configured environment. Cloud agents do not automatically inherit a local .env.local.

## Real demand and competition

- Cochrane Handbook, Chapter 5, section 5.5.8: https://www.cochrane.org/authors/handbooks-and-manuals/handbook/current/chapter-05
  The chapter describes recovering values from figures for systematic reviews. Its chapter update is October 2019, within the 2024 handbook version; do not present it as a new 2026 study.
- Actual May 2026 systematic review with explicit WebPlotDigitizer methods: https://link.springer.com/article/10.1007/s00384-026-05147-1
  Use as evidence that the workflow exists, not as medical advice or an assertion that UNSPIN supports Kaplan–Meier analysis.
- WebPlotDigitizer official documentation: https://automeris.io/docs/
- WebPlotDigitizer code: https://github.com/automeris-io/WebPlotDigitizer
  Verify current hosted features and licensing before code reuse. Do not claim the product lacks AI from older docs.
- PlotPick preprint, revised October 6, 2026: https://arxiv.org/abs/2605.06021
- PlotPick implementation: https://github.com/tommycarstensen/plotpick
  Existing AI batch figure-to-table extraction. The revised paper explicitly limits its benchmark claims and says application/biomedical accuracy remains unestablished. Do not quote withdrawn version-1 claims or extrapolate synthetic-chart results to scientific accuracy.
- Current ChatGPT data analysis capabilities/limitations: https://help.openai.com/en/articles/8437071-data-analysis-with-chatgpt
  Existing PDF/data analysis, Python, and interactive chart functionality. Generic AI is a real baseline, not a straw-man text-only chatbot.
- Empirical research on misleading visualization interpretation: https://www.research-collection.ethz.ch/entities/publication/44b8e55b-0348-46dc-a4d9-28081d058745
  Supports examining presentation choices; does not validate UNSPIN or establish that every truncated axis is dishonest.

## Provider and framework

- Next.js setup: https://nextjs.org/docs/app/getting-started/installation
- Next.js environment variables: https://nextjs.org/docs/app/guides/environment-variables
- Gemini API keys: https://ai.google.dev/gemini-api/docs/api-key
- Gemini models: https://ai.google.dev/gemini-api/docs/models
- Gemini structured outputs: https://ai.google.dev/gemini-api/docs/structured-output
- Gemini document input: https://ai.google.dev/gemini-api/docs/document-processing
- Gemini terms: https://ai.google.dev/gemini-api/terms

Gemini's current unpaid-service terms warn against sensitive/confidential/personal submissions and describe product-improvement/human-review use. Begin real testing with permitted public inputs. Configure paid processing/data handling appropriately before offering confidential document workflows. Structured output guarantees do not establish semantic or numerical correctness.

## Dependency review required at implementation

Consult primary documentation for the exact chosen versions of PDF.js, ExcelJS, Papa Parse, Plotly, TanStack Table/Virtual, decimal.js, the PostgreSQL driver/ORM, Auth0's Next.js SDK, Tiger Data, Vultr, and ElevenLabs. Verify Node/Next compatibility, browser-worker packaging, SSR requirements, hosted-service terms, security advisories, and code/model licenses. Do not use remembered version-specific APIs without checking them.
