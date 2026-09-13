[Back](INDEX.md)

# Models and Configuration

Sources of truth:

- `src/contracts/deepseek/Models.ts`
- `src/contracts/Config.ts`
- `src/application/settings/ConfigurationSchema.ts`
- `src/shared/usage/UsagePricing.ts`
- `src/vscode/storage/SettingsManager.ts`

## Product model

The extension exposes two models. **DeepSeek V4.1 Flash** (`deepseek-flash`) gathers a 1M-token context, a 384K maximum output, and native vision: it reads DeepSeek Files API image references directly, in chat and in tool rounds. **DeepSeek V4 Pro** (`deepseek-v4-pro`) shares the context and output limits but its documented capabilities exclude vision, so a Pro generation reaches images through the Pro-only `analyze_images` tool, which delegates the attached files to Flash. `MODEL_REGISTRY` carries that difference as `supportsVision`; the registry also records DeepSeek's 2500-request concurrency limit for Flash against 500 for Pro.

Retired names are not translated. The `normalizeModelId` compatibility map was removed in `0.1.14`, so `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` are ordinary unknown identifiers: `assertCompatibleModel` rejects them on the official endpoint, the context budget falls back to the conservative 128K/8K profile, and `UsagePricing` publishes no rate for them. A stored setting that still holds one of them has to be re-selected. Model names persisted inside conversations remain opaque data, so history keeps loading without being rewritten.

There is no provider-side transport fallback and no model rewriting: a failed request is surfaced as-is. The hidden Vision-to-Flash retry that masked a retired vision model was removed in `0.1.14` and does not come back; the delegated `analyze_images` tool is the only vision path, and it names `deepseek-flash` directly instead of the retired `deepseek-v4-flash-vision-exp` endpoint.

DeepSeek exposes FIM completion on a beta endpoint, but the extension implements no FIM request path yet.

## Generation configuration

- `model` defaults to `deepseek-flash`; on the official endpoint only a registered model ID is accepted.
- `thinkingEnabled` controls DeepSeek thinking mode; tools remain available when thinking is off.
- `reasoningEffort` is `off`, `high`, or `max` in the product UI.
- `maxTokens` is the requested output allowance, defaults to 384,000, and is clamped from 1 to 384,000.
- `maxConcurrentGenerations` defaults to 8 and is clamped from 1 to 16.
- `permissionMode` is exactly `default`, `auto-approve`, or `full-access`.
- `webSearchEnabled` removes or restores `search_web` and `read_web` in model requests.
- `usageCostCurrency` is `usd` or `cny` and selects how the usage popover displays cost. Any other value is rejected when settings are saved.

Tool execution has no artificial round or tool-call cap; context, output, cancellation, duplicate-call safeguards, and a tool-free progress review every 20 completed rounds remain in force.

The compact chat picker displays model and reasoning together, such as `V4.1 Flash · High`. It stays open while either choice is changed and closes when the user clicks outside.

## Context and output budget

Registered model capabilities use a 1M-token total context and a 384K maximum output. System prompts, tool schemas, history, references, image metadata, requested output, and a safety margin all participate in request budgeting. Unknown compatible endpoints fall back to a conservative 128K context and 8,192 output tokens.

## Usage pricing

`UsagePricing.ts` prices only the official DeepSeek origin; custom endpoints never receive a guessed cost. DeepSeek publishes a USD table and a CNY table instead of an exchange rate, so each display currency uses its own documented numbers.

Off-peak rates per 1M tokens:

| Model             | Currency | Cache hit | Cache miss | Output |
|-------------------|----------|-----------|------------|--------|
| `deepseek-flash`  | USD      | $0.003    | $0.15      | $0.6   |
| `deepseek-flash`  | CNY      | ¥0.02     | ¥1         | ¥4     |
| `deepseek-v4-pro` | USD      | $0.022    | $0.66      | $1.98  |
| `deepseek-v4-pro` | CNY      | ¥0.15     | ¥4.5       | ¥13.5  |

Weekdays 01:00-04:00 and 06:00-10:00 UTC (09:00-12:00 and 14:00-18:00 Beijing time) are billed at twice those rates, and each registered model uses its own row of the table in either currency. A retired or unknown model name yields no estimate instead of borrowing the current rates.

Persisted aggregates stay canonical in USD (`currency: "USD"` plus `costUsd`). `estimateAggregateCost` returns the stored estimate for USD and reprices the reported tokens from the CNY table for display, so no persisted aggregate changes unit when the setting changes. When some requests omit usage, the popover marks the calculable reported-request cost as an explicitly labelled lower bound.

## Image transport

- Supported image signatures are JPEG, PNG, GIF, and WebP.
- Images are uploaded with `purpose=user_data` and a 30-day expiry.
- Provider messages reference `{ type: "file", file_id }`; they do not embed Base64 or local paths.
- Image tokens are billed together with the text tokens of the same request.
- A Pro generation receives the attachment IDs as text in the newest user turn and replays history with `file` parts stripped; only the delegated Flash request carries the file references, and its usage is reported against `deepseek-flash` in the `vision_analysis` phase.

Recheck [DeepSeek Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/) and the [Vision guide](https://api-docs.deepseek.com/guides/vision) before changing identifiers, capabilities, or rates.

[Back](INDEX.md)
