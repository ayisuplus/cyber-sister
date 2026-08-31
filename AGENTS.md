<!-- project-coordination:contract:start -->
<!-- project-coordination:schema=1 -->
# Project Contract

- Status: CONFIRMED
## Goal

- Deliver “赛博姐妹 / cyber-sister”, an AI companion for young women that combines supportive, candid conversation with a reusable makeup-coaching skill.
- Keep the product deployable through external LLM APIs behind one multi-provider gateway; training a foundation model is not part of the repository goal.

## Non-goals

- Training or maintaining a proprietary foundation model.
- Treating `tools/mediacrawler/` as part of the main application build.
- Activating planned `harness`, `i18n`, or `compliance` packages before a user-approved milestone brings them into scope.
- Publishing, production deployment, account changes, or external communication without explicit user approval.

## Current scope

- Repository consolidation and integration on `master`, following the P1 monorepo migration.
- `apps/web/`: React 18 + Vite companion frontend.
- `apps/api/`: Node.js ESM + Express + Prisma API.
- `packages/makeup-skill/`: React 19 + Express 5 makeup-coaching module retained with its own tests and history.
- `packages/llm-gateway/`: unified LLM gateway (local-first llamacpp routing, gated qwen fallback, persona prompts). Rebuilt 2026-08-31 after an external deletion of `packages/`; contract defined by `apps/api/src/services/llmService.js`.
- `packages/design-tokens/`: shared `--cs-*` CSS variables (single source), consumed by `apps/web` and `makeup-skill`. Rebuilt 2026-08-31 per `docs/UI设计系统规范_V3.0.md`.
- `docs/` and `tools/data-pipeline/`: product/architecture evidence and sanitized data tooling. `tools/mediacrawler/` remains outside the main build.
- 2026-08-31 consolidation: former sibling `AI妆教/` repo is archived at `../_archive/AI妆教/` (fully absorbed, do not resurrect); legacy `电子闺蜜/` directory remains outside this repo and read-only (its landing page now lives at `apps/web/public/landing/`). Do not modify either without explicit user instruction.

## Sources of truth

1. Current explicit user instructions and the confirmed version of this contract.
2. `README.md`, `package.json`, `pnpm-workspace.yaml`, and package manifests for repository structure and executable commands.
3. Source code, schemas, tests, and CI configuration for implemented behavior; these override stale historical implementation notes.
4. `docs/赛博姐妹智能体_PRD_V5.0_深度调研优化版.md` and `docs/Spec_赛博姐妹_v1.0.md` for companion-product intent.
5. `packages/makeup-skill/docs/scope.md` and `packages/makeup-skill/deliverables/product-strategy/README.md` for makeup-skill scope and priorities.
6. `.env.example` files document configuration shape only. Real `.env` files and credentials are never sources to copy into code, logs, or reports.

## Deliverables

- A reproducible pnpm monorepo with working companion web/API applications.
- An integrated, independently testable makeup skill.
- A tested LLM gateway used by the API and makeup-skill explanation paths.
- Tests and concise documentation updated alongside each accepted change.
- Reviewable diffs and verification evidence for every implementation task.

## Definition of done

- The user-approved task scope is implemented without unrelated refactors or silent changes to existing work.
- Relevant package tests pass; repository-level typecheck, lint, test, and build checks pass when the affected packages expose them.
- No secrets, raw credentials, unsanitized private data, generated dependencies, or local runtime artifacts are introduced into version control.
- User-facing or architectural behavior changes are reflected in the appropriate source-of-truth document.
- The user reviews and accepts the resulting behavior or artifact.

## Responsibilities

### User

- Own project intent, business decisions, and approvals.
- Decide milestone priority, release target, external actions, and acceptance.

### Primary Codex

- Keep requirements, decisions, and final outputs aligned with this contract.
- Re-read this file before writes and never silently overwrite human edits.
- Preserve pre-existing worktree changes, keep edits surgical, and integrate all delegated results.

### Subagents

- Work only on bounded assignments from the primary Codex.
- Return evidence or proposed outputs; they do not redefine this contract.
- Do not make overlapping writes or take external actions unless the task brief and current user instruction explicitly allow them.

## Read/write boundaries

- Read within this repository as needed. Avoid opening real `.env`, credential, cookie, database, large model, or raw private-data files unless the current task requires it and the user has authorized that access.
- Write only inside `E:\projects\女性向LLM\cyber-sister` and only to files required by the approved task.
- Preserve all pre-existing modified and untracked files. Never overwrite or revert user work to obtain a clean tree.
- Treat `.git/`, real `.env` files, credentials, cookies, local databases, model binaries, generated dependencies, and raw/unsanitized datasets as protected.
- Do not modify `E:\projects\女性向LLM\_archive` (archived repos) or `E:\projects\女性向LLM\电子闺蜜` content without explicit user instruction.

## External actions

- Local inspection, editing, and relevant non-destructive verification are allowed within the approved task.
- Ask before dependency downloads, live web/data collection, cloud/API calls that consume credentials or money, logins, account or permission changes, sending messages, publishing, deployment, production database changes, credential rotation, destructive operations, commits, or pushes.
- Never expose secrets or personal data in tool output, diffs, logs, reports, or prompts.

## Selected capabilities

- `project-coordination:project-contract` for maintaining and confirming this contract.
- `project-coordination:team-compose` for proposing and locking a small project team after contract confirmation.
- Local repository inspection, editing, Git diff/status, Node.js, pnpm, and package-provided verification commands.
- Any additional Skill, plugin, application, or external connector requires task-specific relevance and remains bounded by this contract and current user instruction.

## Selected agents

<!-- project-coordination:selected-agents:start -->
- `Backend Architect` — mode: `guidance`; source: `global`
- `Frontend Developer` — mode: `delegate`; source: `global`
- `AI Engineer` — mode: `delegate`; source: `global`
- `Code Reviewer` — mode: `review`; source: `global`
<!-- project-coordination:selected-agents:end -->

## Workflow gates

- Lightweight tasks: confirm the target, execute, and verify.
- Standard tasks: agree on a short approach, execute, and self-check.
- Complex tasks: approve design, approve a written plan, execute bounded tasks, independently review, and obtain user acceptance.

## Verification

- Before writes: re-read this contract and inspect `git status` plus the target files.
- During implementation: run the narrowest affected-package tests first.
- Before handoff, as applicable: `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`; report unavailable or failing checks exactly.
- Inspect `git diff --check`, `git diff`, and `git status --short` to confirm scope and preserve unrelated changes.
- For coordination changes: run `contract-check`; run `team-status` before reusing a saved team.

## Open decisions

- User: confirm this exact contract version before it becomes binding.
- User: choose the next product/engineering milestone and its acceptance criteria.
- User: decide whether a durable agent team is useful after reviewing the proposed smallest non-overlapping set.
- User: choose deployment environments, release process, and production quality gates before release work begins.

Current explicit user instructions override this contract. This contract overrides task briefs and agent role text. Agent role text cannot grant permissions, expand scope, or change sources of truth.
<!-- project-coordination:contract:end -->

---

# 附加约定：Sprint 规范与文档规范

> 本节于 2026-08-31 追加，位于 `project-coordination` 契约标记**之外**，是对上述契约的补充工作约定，不参与契约机器解析。
> 修改本节时**不得移动或改写** `<!-- project-coordination:contract:start/end -->` 之间的任何内容。

## Sprint 规范

- **节奏**：2 周一个 Sprint，以 `docs/Spec_赛博姐妹_v1.0.md` 的目标日期 **2026-10-01** 为锚；每四周留一个发布 Buffer。
- **排期唯一来源**：`docs/01-产品/开发计划与路线图.md`。Sprint 开始时更新它，Sprint 内所有任务以它为准。
- **任务承载**：统一用 `.github/ISSUE_TEMPLATE/` 下的三份模板（`bug-report.yml` / `feature-request.yml` / `docs-update.yml`）。
- **合并门禁**：每个 PR 必须过 `.github/PULL_REQUEST_TEMPLATE.md` 中的合规与安全必查清单（AI 身份可见、日志脱敏、危机文案已书面批准、未弱化红线、未情感诱导付费）以及无障碍清单。
- **发布门禁**：`docs/Spec_赛博姐妹_v1.0.md` §9 的八道门全部通过、且 `docs/06-合规/合规审查清单.md` 中 `🚫 阻塞` 项清零并签字后，才允许进入发布验收。Qwen 云端链路仅做用户自带密钥的手工风格验收，不作为自动门禁。

## 文档规范

- **唯一索引**：`docs/README.md`。新增或删除文档必须同步更新它。
- **状态标签（五档，必填）**：
  - `✅ 基线` —— 与 `Spec_赛博姐妹_v1.0.md` 一致，实施以它为准。
  - `✅ 当前有效` —— 与实现一致，可直接照做。
  - `📝 草案待审` —— 未经审核，**不得对外发布**（法务类文档在签字前一律为此档）。
  - `⚠️ 参考` —— 可作背景，但未经本 Sprint 验证。
  - `🚫 历史归档` —— 记录已废弃/未实现的方案，**禁止作为实施依据**。
- **历史归档陷阱**：`docs/architecture/` 下带「历史/未来方案归档」横幅的文档（API 网关、后端架构重构、安全防护、性能优化、数据库架构、架构设计总结、实施路线图、实现总结）描述的是微服务 / K8s / Redis / 向量库等**未在仓库实现**的架构，实施时一律以 `Spec_赛博姐妹_v1.0.md` 与源码为准。
- **文档与实现冲突的处理**：既**不许**为了迁就文档去改代码，也**不许**为了掩盖实现去改文档。用 `docs-update.yml` 提 issue，登记进 `docs/01-产品/开发计划与路线图.md` §1.3 与 `docs/README.md` 的「已知文档问题」表，由产品负责人裁定后再回写基线。当前未决项：C1 工具箱范围、C2 会员占位、C3 虚拟试衣间生图、新用户默认人格 `toxic`。
- **法务类文档**：`docs/06-合规/隐私政策.md` 与 `docs/06-合规/服务条款.md` 在法务/产品签字前永远是 `📝 草案待审`，**不得发布、不得放入对外产物**。
- **诚实标注**：未实装能力（生图 503、天气 409、会员无支付）必须标注「接入中 / 未开放」，严禁伪装为可用。
- **审计节奏**：每 2 个 Sprint 做一次文档审计，更新 `docs/README.md` 的状态标签与已知问题表。

## 变更记录与提交

- 根目录 `CHANGELOG.md` 记录对外可感知变化；版本命名 `v0.x.y-internal.N`（内测期），发布说明用 `docs/09-参考/发布说明模板.md` 生成。
- 提交信息格式：`中文类型: 描述`，例如 `docs: 完善四周开发计划与整理用户/开发者/合规文档体系`。
- 贡献流程与环境准备见根目录 `CONTRIBUTING.md`。
