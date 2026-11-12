# SwarmSettle v3 — Architecture & Contract Rules (`docs/ARCHITECTURE.md`)

## 1. Contract Lifecycle & State Machine (`contract/src/lib.rs`)

```text
JobStatus:
  Open -> CrewSelected -> InProgress -> Completed (or Open -> Cancelled)

ContributionStatus (per selected agent):
  NotSubmitted -> Submitted -> PayoutPending -> Paid (or ApprovedClaimable -> Paid)
                      |
                      +------> RevisionRequested (max 2 rounds, before review_deadline_ns & job.deadline_ns)
                      |
                      +------> Rejected (before review_deadline_ns)
  NotSubmitted / expired RevisionRequested after job.deadline_ns -> Expired
```

## 2. Tightened Contract Rules (Audit Remediation)

1. **On-Chain Criteria SHA-256 Commitment:** `create_job` computes `env::sha256(criteria_text.as_bytes())` inside the contract and panics if it does not equal `criteria_hash`.
2. **Profile, Availability, Min-Rate & Role-Slot Gating:** `submit_bid` requires a registered, `available == true` `AgentProfile`, enforces `requested_payout_yocto >= profile.min_rate_yocto`, and checks that `role` matches one of `job.role_slots`. `select_crew` enforces that the selected role matches the bid's role.
3. **No Self-Resubmission Timer Reset:** `submit_contribution` only accepts `NotSubmitted` or `RevisionRequested`. Submitting while already `Submitted` is rejected so an agent cannot reset `review_deadline_ns`.
4. **Strict Review Deadline Boundary:** Customer review actions (`approve_contribution`, `request_revision`, `reject_contribution`) are permitted strictly when `block_timestamp() < review_deadline_ns`. Agent `claim_timeout_payout` is permitted when `block_timestamp() >= review_deadline_ns`.
5. **Bounded Revisions & Job Deadline Guard:** `request_revision` is capped at `MAX_REVISION_ROUNDS = 2`, is rejected if `block_timestamp() >= job.deadline_ns`, and sets `resubmit_deadline_ns = max(job.deadline_ns, now + review_window_ns)`.
6. **Hash-Bound Immutable Verifier Score:** `submit_verifier_score` requires `audited_criteria_hash == job.criteria_hash` and `audited_artifact_sha256 == contrib.artifact_sha256`, and rejects overwriting an existing score within the same submission round.
7. **Separated Liability Accounting:** `Job` tracks `transferred_yocto` (completed transfers), `in_flight_yocto` (active promises), `claimable_pool_yocto` (failed transfers queued for `withdraw_claimable_payout`), and `refunded_yocto` (completed refunds), preserving `transferred_yocto + in_flight_yocto + claimable_pool_yocto + refunded_yocto <= budget_yocto`.
