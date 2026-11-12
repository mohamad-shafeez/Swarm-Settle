# SwarmSettle

**Multi-agent task coordination, verifiable deliverable hashing, and rule-enforced escrow settlement on NEAR Testnet.**

## Problem

AI agents can already research, model unit economics, and review documents. Coordinating multiple specialist agents on a single mission creates an accounting and trust problem:

1. **Moving goalposts**: If acceptance criteria change mid-task, neither the customer nor the agents can prove what was originally agreed.
2. **Unclear payout rules**: When three specialists collaborate on one budget, who gets paid how much, and what happens to unallocated funds?
3. **Unverified deliverables & ghosting**: How does a customer verify byte-level file integrity before paying—and how do agents get paid if the customer disappears without reviewing submitted work?

## Solution

SwarmSettle is a NEAR smart contract (`contract/src/lib.rs`), multi-agent runner (`agents/`), and web application (`app/`) where:

- **One mission, committed criteria**: The customer deposits Testnet NEAR via `create_job` and commits both `criteria_text` and `criteria_hash = SHA-256(criteria_text)`. The contract recomputes and verifies the SHA-256 digest on-chain.
- **Role-scoped specialist bidding**: Registered specialist agents (`ResearchPro`, `MarketMind`, `VerifyAI`) bid on defined role slots (`submit_bid`). The customer selects a crew (`select_crew`), and the contract enforces `sum(agreed_payout_yocto) <= budget_yocto`.
- **Byte-level deliverable integrity & advisory verification**: Each selected agent submits a deliverable file (`submit_contribution`) with its `artifact_sha256`. The browser recomputes SHA-256 from the actual file bytes, and the Quality Auditor posts an advisory review (`submit_verifier_score`) bound to `criteria_hash` and `artifact_sha256`.
- **Promise-safe settlement, refunds, and timeout claims**: Customer approval (`approve_contribution` per agent) transfers each agent's agreed payout with a 15-TGas callback (`on_payout_complete`) and pull-payment fallback (`withdraw_claimable_payout`). Unallocated funds return to the customer (`claim_remaining_refund`), and unreviewed submissions can be claimed by the agent after the review window expires (`claim_timeout_payout`).

## Architecture

```
Customer Wallet (MyNearWallet Testnet)
   │
   ├── 1. create_job(title, criteria_text, criteria_hash, role_slots) + 10 NEAR deposit
   ├── 2. select_crew(job_id, [{ agent, role, agreed_payout_yocto }])  (3 + 3 + 2 = 8 NEAR)
   ├── 3. approve_contribution(job_id, agent_id, rating) × 3           (pays 3, 3, 2 NEAR)
   └── 4. claim_remaining_refund(job_id)                               (returns 2 NEAR)
           │
           ▼
NEAR Smart Contract (contract/src/lib.rs)
   ▲
   ├── register_agent_profile(...)
   ├── submit_bid(job_id, role, requested_payout_yocto, proposal)
   ├── submit_contribution(job_id, artifact_uri, artifact_sha256, evidence_notes)
   └── submit_verifier_score(job_id, target_agent_id, audited_criteria_hash, audited_artifact_sha256, quality_score, ...)
           │
Specialist Agent Runner (agents/agent-runner.mjs)
```

## On-Chain Proof (NEAR Testnet)

> Populate these fields from `proof/testnet-run.json` after running `bash scripts/deploy-testnet.sh`:

- **Network**: `testnet`
- **Deployed Contract ID**: `[FILL AFTER DEPLOY: e.g. swarmsettle.<your-account>.testnet]`
- **`create_job` Transaction**: `[FILL AFTER DEPLOY]`
- **`select_crew` Transaction**: `[FILL AFTER DEPLOY]`
- **`submit_contribution` Transactions**: `[FILL AFTER DEPLOY]`
- **`submit_verifier_score` Transaction**: `[FILL AFTER DEPLOY]`
- **`approve_contribution` Transactions**: `[FILL AFTER DEPLOY]`
- **`claim_remaining_refund` Transaction**: `[FILL AFTER DEPLOY]`

## How to Build, Test, and Run

### 1. Contract Unit Tests & WASM Build

```bash
cd contract
cargo test
cargo near build
```

### 2. JavaScript State-Machine Model & Repository Verification

```bash
npm test
npm run verify
```

### 3. Deploy to NEAR Testnet & Execute Live Run

Copy `.env.example` to `.env`, add your funded NEAR Testnet account credentials and LLM API key, and run:

```bash
bash scripts/deploy-testnet.sh
```

This script deploys the compiled WASM contract to NEAR Testnet, writes `app/.env.local`, executes a full live Testnet run, and records the transaction hashes in `proof/testnet-run.json`.

### 4. Start the Web Application

```bash
cd app
npm install
npm run dev
```

## Prototype Scope & Limitations

- **Testnet prototype**: SwarmSettle operates on NEAR Testnet; Testnet NEAR tokens have no live-money value.
- **Advisory verifier score**: `submit_verifier_score` records an advisory quality evaluation bound to the committed criteria hash and deliverable hash; it does not automatically release or reject escrow funds.
- **Operator account metadata**: An agent profile's `declared_operator_account` is informational metadata declared at registration; on-chain payouts transfer directly to the agent's `account_id`, so an operator receives service revenue only when they control that receiving account's keys.
