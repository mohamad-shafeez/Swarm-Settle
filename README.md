# SwarmSettle

**One task. A temporary AI crew. Transparent on-chain settlement.**

SwarmSettle is a multi-agent work coordination protocol: a customer funds one mission on NEAR, specialist AI agents bid for role-scoped work, deliverables are bound to SHA-256 digests, and escrow settlement follows rules enforced by a Rust smart contract.

> **Status:** working NEAR Testnet prototype. Testnet NEAR has no live-money value. The bundled demo runs in an explicitly badged **Simulation Preview** so judges can inspect every step without wallet keys. The same UI methods switch to real NEAR Testnet RPC + MyNearWallet signing in **Live Testnet Mode**.

---

## The problem

AI agents can research, model unit economics, and audit documents. Coordinating several specialists on one paid mission creates an accounting and trust problem:

1. **Moving goalposts** — if acceptance criteria change mid-task, nobody can prove what was originally agreed.
2. **Unclear payout rules** — when three specialists share one budget, who gets paid how much, and what happens to unallocated funds?
3. **Unverified deliverables and ghosting** — how does a customer verify file integrity before paying, and how does an agent get paid if the customer disappears without reviewing?

## The solution

SwarmSettle combines three pieces:

| Component | Responsibility |
|---|---|
| **AI agents** (`agents/`) | Generate role-specific proposals and deliverables; run in live Testnet or clearly labelled simulation mode. |
| **SwarmSettle app** (`app/`) | Creates missions, compares bids, verifies file hashes, inspects advisory audits, and drives settlement. |
| **NEAR contract** (`contract/`) | Holds escrow, recomputes the criteria digest, enforces budget/payout rules, releases payouts, and accounts for refunds. |

### Core contract rules

- **One mission, committed criteria** — `create_job` recomputes `SHA-256(criteria_text)` on-chain and rejects a mismatched `criteria_hash`.
- **Role-scoped bidding** — `submit_bid` requires a registered, available agent, enforces the registered minimum rate, and checks the role against the mission's role slots.
- **Budget-safe crew selection** — `select_crew` enforces `sum(agreed_payout_yocto) <= budget_yocto` and one agent per role slot.
- **Byte-level deliverable integrity** — `submit_contribution` records `artifact_sha256`; the web app recomputes SHA-256 from the actual file bytes.
- **Advisory verification** — `submit_verifier_score` binds the auditor's score to the exact `criteria_hash` and `artifact_sha256`; it does not release funds automatically.
- **Promise-safe settlement** — `approve_contribution` pays the agreed share with a 15-TGas callback and pull-payment fallback. `claim_remaining_refund` returns unallocated funds. `claim_timeout_payout` protects agents after the review window expires.

## Verified locally

```text
✔ 24/24 JavaScript contract state-machine invariant tests
✔ Contract-to-frontend ABI alignment check
✔ Secret-hygiene check (no committed .env)
✔ TypeScript strict typecheck
✔ Vite production build
```

Run everything:

```bash
npm install
npm --prefix app install
npm run check        # tests + ABI/secret verification + app build
```

> Rust/Cargo is required only for `cargo test` / `cargo near build` in `contract/`. The JavaScript suite models the same state machine and runs without Rust.

## Run the demo

```bash
npm --prefix app run dev
# open http://127.0.0.1:5173
```

The app opens in **Simulation Preview** (amber banner) with a seeded mission. Walk the five tabs:

1. **Mission Overview** — 10 NEAR funded, live escrow KPIs.
2. **Create & Fund Mission** — criteria text + computed SHA-256; `create_job`.
3. **Bids & Crew Selection** — ResearchPro (3), MarketMind (3), VerifyAI (2); CodeSmith is excluded because the mission has no software role slot. Lock the 8 NEAR crew.
4. **Deliverables & SHA-256** — recompute the digest from file bytes, simulate a one-byte tamper (mismatch), restore, approve all.
5. **Settlement** — 8 NEAR paid, 2 NEAR refunded, conservation check `8 + 2 = 10`, plus the exact contract calls that produced it.

### Demo video

A 2-minute, 1920×1080 / 30 fps walkthrough with burned-in captions is generated from the real running app:

```bash
npm run demo:record
# output: demo/SwarmSettle_Demo_2min.mp4
```

The recording script (`scripts/record-demo.mjs`) drives Chrome, captures the viewport via CDP screencast, and encodes with ffmpeg. See `docs/VIDEO_SCRIPT.md` for the timing and narration.

## Live NEAR Testnet mode

1. Copy `.env.example` to `.env` and add a funded NEAR Testnet account plus agent keys.
2. Deploy and run the live preflight:

```bash
bash scripts/deploy-testnet.sh
```

This builds the contract, deploys it, writes `app/.env.local`, verifies the deployed contract account, and records the preflight result in `proof/testnet-run.json`.

3. Start the app and switch to **Live Testnet Mode**, then connect MyNearWallet. The app signs `create_job`, `select_crew`, `approve_contribution`, and `claim_remaining_refund` against the deployed contract.

The repo intentionally ships **without** a live deployment or private keys. Fill the proof file with your own transaction hashes after your deployment; never commit `.env` or keys.

## Repository layout

```text
contract/src/lib.rs              Rust escrow + state machine + unit tests
agents/agent-runner.mjs          Live/simulation specialist workflow
agents/llm-provider.mjs          Gemini / OpenAI / Anthropic provider adapter
agents/artifact-store.mjs        Writes + re-reads artifacts, recomputes SHA-256
app/src/App.tsx                  Five-step mission console
app/src/lib/near.ts              RPC views, wallet selector, signed calls
app/src/lib/hashing.ts           Browser SHA-256 over text and raw bytes
app/src/lib/yocto.ts             Lossless yoctoNEAR arithmetic
scripts/test-contract-invariants.mjs   24-test contract model
scripts/verify.mjs               Repo + ABI + secret verification
scripts/record-demo.mjs          Automated 2-minute demo recorder
docs/ARCHITECTURE.md             Contract state machine and invariants
docs/VIDEO_SCRIPT.md             2-minute narration + shot list
```

## Honest scope and limitations

- **Testnet prototype** — NEAR Testnet tokens have no real-world monetary value.
- **SHA-256 proves integrity, not quality** — a matching digest proves the file was not changed after its digest was recorded. It does not prove the content is correct or truthful.
- **Advisory verifier** — VerifyAI's score is recorded and bound to the criteria/artifact hashes, but the customer still approves payouts. There is no autonomous arbitration court in this MVP.
- **Operator metadata** — an agent profile's `declared_operator_account` is informational. Payouts go to the agent's `account_id`; an operator earns only when they control that receiving account's keys.
- **No bundled live deployment** — the repo cannot ship funded Testnet keys. Live mode fails closed until `NEAR_CONTRACT_ID`, per-agent keys, and an LLM API key are configured.
