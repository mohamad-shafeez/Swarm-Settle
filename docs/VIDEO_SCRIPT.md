# SwarmSettle — 2-Minute Demo Script & Shot List

**Output:** `demo/SwarmSettle_Demo_2min.mp4` — 1920×1080, 30 fps, 120 seconds.

**Mode:** the recording runs in **Simulation Preview**. The amber banner is visible for the entire video, and the settlement receipt is labelled **NOT ON-CHAIN**. This is deliberate: the repo does not ship funded Testnet keys. Live Testnet Mode signs the same contract methods with MyNearWallet.

Use the narration below to generate the voiceover. Timings match `scripts/record-demo.mjs`.

| Time | On screen | Narration |
|---|---|---|
| 0:00–0:07 | Title card → mission overview | **SwarmSettle.** One funded mission. A temporary crew of specialist AI agents. Transparent settlement on NEAR. |
| 0:07–0:20 | Dashboard: 10 NEAR escrow, allocation/paid/refund KPIs, three-step explanation | The customer locks a **10 NEAR escrow budget** and commits the acceptance criteria with a SHA-256 digest. |
| 0:20–0:36 | Create & Fund Mission: criteria text, computed hash, `create_job` | The contract recomputes **SHA-256(criteria_text) on-chain**, so the goalposts cannot move after funding. |
| 0:36–0:51 | Bid cards: ResearchPro 3, MarketMind 3, VerifyAI 2, CodeSmith excluded; `select_crew` | Specialist agents bid by role. The customer locks a crew only if total payouts stay inside the 10 NEAR budget. |
| 0:51–1:04 | Deliverables: recompute SHA-256, green integrity match | Each deliverable is bound to a SHA-256 digest. The browser recomputes the hash from the **actual file bytes**. |
| 1:04–1:21 | One-byte tamper → red mismatch → restore → green match | Change one byte and the digest fails. Restore the original file and byte-level integrity passes again. |
| 1:21–1:34 | VerifyAI advisory panel: 95/100, criteria hash + artifact hash binding | VerifyAI's advisory score is bound to the exact criteria hash and artifact hash. The customer still approves payouts. |
| 1:34–1:50 | Approve all → escrow: 10 funded, 8 paid, 2 refunded, conservation check, receipt | Approval pays each agreed share. The unallocated **2 NEAR returns to the customer**. Conservation holds: **8 + 2 = 10**. |
| 1:50–2:00 | End card: Rust contract, 24/24 tests, escrow balanced, Testnet disclaimer | SwarmSettle — a NEAR Testnet prototype. **24/24 contract invariant tests**. Testnet NEAR has no live-money value. |

## Audio generation notes

- Target **120 seconds**. Speak at a measured pace; the captions are the authoritative script.
- Tone: confident, technical, honest. Avoid claiming live on-chain transactions during the simulation walkthrough.
- Suggested voice: warm, clear, mid-tempo; no background music, or a very low ambient bed.
- If your TTS produces a shorter file, pad the tail with silence rather than speeding up the video.

## Re-recording

```bash
# terminal 1
cd app
npm run dev -- --host 127.0.0.1 --port 5173

# terminal 2
npm run demo:record
```

Requirements: Node 18+, Chrome or Edge, and `ffmpeg` on `PATH`. Set `CHROME_PATH` if Chrome is installed elsewhere.

## What is real vs. simulated in the video

| Element | Status |
|---|---|
| React UI, wallet adapter, RPC view calls, SHA-256 recomputation | Real code, running locally |
| Contract state machine, 24 invariant tests, ABI alignment | Real, executed by `npm test` / `npm run verify` |
| Rust contract source | Real; Rust build requires Cargo (not bundled in the recording environment) |
| Mission state, bids, payouts | Seeded Simulation Preview state, explicitly badged |
| Settlement receipt | Labelled **Simulated contract calls (NOT ON-CHAIN)** |
| Live NEAR Testnet transactions | Not claimed; requires your deployed contract and keys |
