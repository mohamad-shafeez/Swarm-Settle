# SwarmSettle — Honest Video Demo Script (`docs/DEMO_SCRIPT.md`)

> **Note:** this is the original 90-second narrative. The recorded 2-minute walkthrough and its exact timings are in [`docs/VIDEO_SCRIPT.md`](./VIDEO_SCRIPT.md).

**Core Positioning:** *A customer funds one task. Specialist AI agents bid and complete separate pieces of work. The customer can inspect evidence, and the NEAR contract enforces the agreed payment and refund rules.*

---

## 90-Second Demo Narrative (Section 8 of Master Brief)

### 1. Problem (0:00–0:12)
> *"Businesses can ask a single AI a question, but larger deliverables need multiple specialists—research, financial analysis, and quality assurance. Today, hiring, coordinating, and paying separate agents is difficult to audit."*

### 2. Solution (0:12–0:24)
> *"SwarmSettle turns one customer task into a funded work order on NEAR with separate specialist contributions, cryptographic deliverable digests, and contract-enforced settlement and refund rules."*

### 3. AI as Software Agent & How the Developer Earns (0:24–0:40)
> *"ResearchPro, MarketMind, and VerifyAI are software agents operated by developers—they don't magically own money. When a customer funds a task and an agent's work is approved—or becomes eligible under the contract's review-timeout rule—the contract transfers NEAR to that **agent's account**. The human developer earns because they control that agent account and provide the model and compute."*

### 4. Walkthrough & Proof (0:40–1:15)
1. **Create & Fund Mission:** Show `create_job` with the acceptance checklist and matching `SHA-256` digest (`814ef58c...`) verified by the contract.
2. **Agent Bids & Deterministic Crew Composer:** Show `ResearchPro` (`2 NEAR`), `MarketMind` (`3 NEAR`), and `VerifyAI` (`1.5 NEAR`) bidding against defined role slots, while `CodeSmith` is excluded with a clear `"Why Not Selected"` reason because `Software Development` is not a required role slot for this mission.
3. **Distinct Artifacts & SHA-256 Verification:** Show each selected agent's distinct deliverable file (`8f82dd4a...`, `d35d1c74...`, `43542b4e...`), click **Recompute & Verify SHA-256 / Download**, and show `VerifyAI`'s advisory audit bound to the exact criteria and artifact hashes.
4. **Settlement & Review Window Boundary:** Show customer approval transferring NEAR to the agent account, and explain the strict `review_deadline_ns` boundary protecting agents if a customer never reviews.

### 5. Close & Honest Disclosure (1:15–1:30)
> *"SwarmSettle is a NEAR Testnet prototype—Testnet tokens have no real-world monetary value, and simulation preview mode is always explicitly badged."*
