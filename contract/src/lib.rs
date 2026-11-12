use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::collections::{LookupMap, UnorderedMap};
use near_sdk::json_types::{U128, U64};
use near_sdk::{
    env, ext_contract, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault,
    Promise, PromiseError,
};

/// Minimum funded escrow budget: 0.1 NEAR (10^23 yoctoNEAR).
pub const MIN_JOB_BUDGET_YOCTO: u128 = 100_000_000_000_000_000_000_000;
/// Minimum bid or crew allocation: 0.01 NEAR (10^22 yoctoNEAR).
pub const MIN_AGENT_PAYOUT_YOCTO: u128 = 10_000_000_000_000_000_000_000;

/// Default creator review window after an agent submits a deliverable: 48 hours in nanoseconds.
pub const DEFAULT_REVIEW_WINDOW_NS: u64 = 48 * 3_600 * 1_000_000_000;
/// Minimum allowed review window: 1 hour in nanoseconds.
pub const MIN_REVIEW_WINDOW_NS: u64 = 3_600 * 1_000_000_000;
/// Maximum allowed creator revision requests per contribution to prevent infinite review loops.
pub const MAX_REVISION_ROUNDS: u32 = 2;

/// Strict upper bounds to prevent unbounded gas/storage exhaustion attacks.
pub const MAX_TITLE_LEN: usize = 140;
pub const MAX_DESC_LEN: usize = 2_000;
pub const MAX_CRITERIA_TEXT_LEN: usize = 2_000;
pub const MAX_ROLE_LEN: usize = 64;
pub const MAX_PROPOSAL_LEN: usize = 1_000;
pub const MAX_URI_LEN: usize = 512;
pub const MAX_NOTES_LEN: usize = 1_000;
pub const MAX_REASON_LEN: usize = 500;
pub const MIN_CREW_SIZE: u32 = 2;
pub const MAX_CREW_SIZE: u32 = 10;
pub const MAX_BIDS_PER_JOB: usize = 50;
pub const MAX_SKILLS_PER_AGENT: usize = 12;
pub const MAX_SKILL_LEN: usize = 48;
pub const SHA256_HEX_LEN: usize = 64;

/// Gas reserved for asynchronous transfer verification callbacks (15 TGas).
pub const CALLBACK_GAS: Gas = Gas::from_tgas(15);

#[derive(BorshSerialize, BorshStorageKey)]
#[borsh(crate = "near_sdk::borsh")]
pub enum StorageKey {
    Jobs,
    JobBids,
    JobContributions,
    AgentStatsMap,
    AgentProfiles,
    ClaimablePayouts,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum JobStatus {
    Open,
    CrewSelected,
    InProgress,
    Completed,
    Cancelled,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum BidStatus {
    Pending,
    Selected,
    NotSelected,
    Withdrawn,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ContributionStatus {
    NotSubmitted,
    Submitted,
    RevisionRequested,
    PayoutPending,
    Paid,
    ApprovedClaimable,
    Rejected,
    Expired,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct RoleSlotInput {
    pub role: String,
    pub suggested_payout_yocto: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct CrewSelectionInput {
    pub agent: AccountId,
    pub role: String,
    pub agreed_payout_yocto: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Job {
    pub id: u64,
    pub creator: AccountId,
    pub title: String,
    pub description: String,
    pub criteria_text: String,
    pub criteria_hash: String,
    pub role_slots: Vec<RoleSlotInput>,
    pub deadline_ns: U64,
    pub review_window_ns: U64,
    pub status: JobStatus,
    pub budget_yocto: U128,
    pub allocated_yocto: U128,
    /// Funds actually transferred out to agent accounts after successful callback.
    pub transferred_yocto: U128,
    /// Funds currently in flight in an asynchronous transfer or refund promise.
    pub in_flight_yocto: U128,
    /// Funds queued in pull-payment fallback (`claimable_payouts`) after a failed async transfer.
    pub claimable_pool_yocto: U128,
    /// Funds actually transferred back to the creator via cancellation or remaining refund.
    pub refunded_yocto: U128,
    pub max_agents: u32,
    pub selected_agents: Vec<AccountId>,
    pub created_at_ns: U64,
    pub updated_at_ns: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Bid {
    pub job_id: u64,
    pub agent: AccountId,
    pub role: String,
    pub requested_payout_yocto: U128,
    pub proposal: String,
    pub estimated_hours: u32,
    pub status: BidStatus,
    pub created_at_ns: U64,
    pub updated_at_ns: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Contribution {
    pub job_id: u64,
    pub agent: AccountId,
    pub role: String,
    pub agreed_payout_yocto: U128,
    pub artifact_uri: String,
    pub artifact_sha256: String,
    pub evidence_notes: String,
    pub feedback_reason: String,
    pub status: ContributionStatus,
    pub submission_count: u32,
    pub revision_count: u32,
    pub submitted_at_ns: U64,
    pub review_deadline_ns: U64,
    pub resubmit_deadline_ns: U64,
    pub resolved_at_ns: U64,
    /// Advisory quality score (0..=100) bound to exact criteria_hash and artifact_sha256.
    pub verifier_score: Option<u8>,
    pub verifier_summary: String,
    pub verifier_report_sha256: String,
    pub verifier_audited_criteria_hash: String,
    pub verifier_audited_artifact_sha256: String,
    pub verifier_agent: Option<AccountId>,
    pub customer_rating: Option<u8>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct AgentStats {
    pub account_id: AccountId,
    pub bids_submitted: u32,
    pub crews_selected: u32,
    pub accepted_contributions: u32,
    pub rejected_contributions: u32,
    pub expired_contributions: u32,
    pub revisions_requested: u32,
    pub jobs_completed: u32,
    pub on_time_deliveries: u32,
    pub timeout_claims: u32,
    pub rating_sum: u32,
    pub rating_count: u32,
    /// Total NEAR actually transferred (or credited via pull-claim) after approval/timeout.
    pub total_earned_yocto: U128,
}

impl AgentStats {
    pub fn new(account_id: AccountId) -> Self {
        Self {
            account_id,
            bids_submitted: 0,
            crews_selected: 0,
            accepted_contributions: 0,
            rejected_contributions: 0,
            expired_contributions: 0,
            revisions_requested: 0,
            jobs_completed: 0,
            on_time_deliveries: 0,
            timeout_claims: 0,
            rating_sum: 0,
            rating_count: 0,
            total_earned_yocto: U128(0),
        }
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct AgentProfile {
    pub account_id: AccountId,
    /// Operator account declared by the agent at registration (not cryptographically proven ownership;
    /// all payouts settle directly to `account_id`).
    pub declared_operator_account: AccountId,
    pub display_name: String,
    pub primary_role: String,
    pub specialty_summary: String,
    pub skills: Vec<String>,
    pub endpoint_or_handle: String,
    pub min_rate_yocto: U128,
    pub available: bool,
    pub registered_at_ns: U64,
    pub updated_at_ns: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct JobTreasurySummary {
    pub job_id: u64,
    pub status: JobStatus,
    pub budget_yocto: U128,
    pub allocated_yocto: U128,
    pub unallocated_reserve_yocto: U128,
    pub transferred_yocto: U128,
    pub in_flight_yocto: U128,
    pub claimable_pool_yocto: U128,
    pub locked_for_active_work_yocto: U128,
    pub released_from_rejections_or_expiry_yocto: U128,
    pub refunded_yocto: U128,
    pub currently_refundable_yocto: U128,
}

fn emit_nep297_event(event: &str, data: serde_json::Value) {
    let payload = serde_json::json!({
        "standard": "swarm-settle",
        "version": "3.0.0",
        "event": event,
        "data": [data]
    });
    env::log_str(&format!("EVENT_JSON:{}", payload));
}

fn bytes_to_hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

fn compute_sha256_hex(input: &str) -> String {
    let hash_bytes = env::sha256(input.as_bytes());
    bytes_to_hex_lower(&hash_bytes)
}

fn validate_and_normalize_sha256(digest: &str, field_name: &str) -> String {
    let trimmed = digest.trim().strip_prefix("0x").unwrap_or(digest.trim());
    require!(
        trimmed.len() == SHA256_HEX_LEN && trimmed.chars().all(|c| c.is_ascii_hexdigit()),
        format!(
            "{} must be an exact 64-character hexadecimal SHA-256 digest",
            field_name
        )
    );
    trimmed.to_ascii_lowercase()
}

fn validate_non_empty_bounded(val: &str, field_name: &str, max_len: usize) -> String {
    let trimmed = val.trim();
    require!(!trimmed.is_empty(), format!("{} cannot be empty", field_name));
    require!(
        trimmed.len() <= max_len,
        format!("{} exceeds maximum length of {} bytes", field_name, max_len)
    );
    trimmed.to_string()
}

#[ext_contract(ext_self)]
pub trait SwarmSettleCallbacks {
    fn on_payout_complete(
        &mut self,
        job_id: u64,
        agent_id: AccountId,
        amount_yocto: U128,
        was_timeout_claim: bool,
        #[callback_result] call_result: Result<(), PromiseError>,
    ) -> bool;

    fn on_refund_complete(
        &mut self,
        job_id: u64,
        creator_id: AccountId,
        amount_yocto: U128,
        was_cancellation: bool,
        #[callback_result] call_result: Result<(), PromiseError>,
    ) -> bool;

    fn on_claimable_withdrawal_complete(
        &mut self,
        job_id: Option<u64>,
        beneficiary: AccountId,
        amount_yocto: U128,
        was_creator_refund: bool,
        #[callback_result] call_result: Result<(), PromiseError>,
    ) -> bool;
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct SwarmSettleContract {
    pub next_job_id: u64,
    pub jobs: UnorderedMap<u64, Job>,
    pub job_bids: LookupMap<u64, Vec<Bid>>,
    pub job_contributions: LookupMap<u64, Vec<Contribution>>,
    pub agent_stats: LookupMap<AccountId, AgentStats>,
    pub agent_profiles: UnorderedMap<AccountId, AgentProfile>,
    pub claimable_payouts: LookupMap<AccountId, u128>,
}

#[near]
impl SwarmSettleContract {
    #[init]
    pub fn new() -> Self {
        Self {
            next_job_id: 1,
            jobs: UnorderedMap::new(StorageKey::Jobs),
            job_bids: LookupMap::new(StorageKey::JobBids),
            job_contributions: LookupMap::new(StorageKey::JobContributions),
            agent_stats: LookupMap::new(StorageKey::AgentStatsMap),
            agent_profiles: UnorderedMap::new(StorageKey::AgentProfiles),
            claimable_payouts: LookupMap::new(StorageKey::ClaimablePayouts),
        }
    }

    // =========================================================================
    // 1. AGENT PROFILE REGISTRY
    // =========================================================================

    pub fn register_agent_profile(
        &mut self,
        display_name: String,
        primary_role: String,
        specialty_summary: Option<String>,
        skills: Vec<String>,
        endpoint_or_handle: String,
        min_rate_yocto: U128,
        declared_operator_account: Option<AccountId>,
        available: Option<bool>,
    ) -> AgentProfile {
        let caller = env::predecessor_account_id();
        let now = env::block_timestamp();
        let clean_name = validate_non_empty_bounded(&display_name, "display_name", 80);
        let clean_role = validate_non_empty_bounded(&primary_role, "primary_role", MAX_ROLE_LEN);
        let clean_summary = match specialty_summary {
            Some(s) if !s.trim().is_empty() => {
                validate_non_empty_bounded(&s, "specialty_summary", 280)
            }
            _ => format!("Specialist {} agent on NEAR", clean_role),
        };
        require!(
            skills.len() <= MAX_SKILLS_PER_AGENT,
            "Exceeded maximum number of skills per agent"
        );
        require!(
            min_rate_yocto.0 >= MIN_AGENT_PAYOUT_YOCTO,
            "min_rate_yocto must be at least 0.01 NEAR"
        );
        let mut clean_skills = Vec::with_capacity(skills.len());
        for s in skills {
            clean_skills.push(validate_non_empty_bounded(&s, "skill", MAX_SKILL_LEN));
        }
        let clean_endpoint = if endpoint_or_handle.trim().is_empty() {
            String::new()
        } else {
            validate_non_empty_bounded(&endpoint_or_handle, "endpoint_or_handle", MAX_URI_LEN)
        };

        let operator = declared_operator_account.unwrap_or_else(|| caller.clone());
        let is_available = available.unwrap_or(true);

        let existing_registered = self
            .agent_profiles
            .get(&caller)
            .map(|p| p.registered_at_ns)
            .unwrap_or(U64(now));

        let profile = AgentProfile {
            account_id: caller.clone(),
            declared_operator_account: operator.clone(),
            display_name: clean_name,
            primary_role: clean_role.clone(),
            specialty_summary: clean_summary,
            skills: clean_skills,
            endpoint_or_handle: clean_endpoint,
            min_rate_yocto,
            available: is_available,
            registered_at_ns: existing_registered,
            updated_at_ns: U64(now),
        };
        self.agent_profiles.insert(&caller, &profile);

        if self.agent_stats.get(&caller).is_none() {
            self.agent_stats
                .insert(&caller, &AgentStats::new(caller.clone()));
        }

        emit_nep297_event(
            "agent_profile_registered",
            serde_json::json!({
                "agent": caller,
                "declared_operator_account": operator,
                "primary_role": clean_role,
                "min_rate_yocto": min_rate_yocto.0.to_string(),
                "available": is_available,
                "timestamp_ns": now.to_string()
            }),
        );
        profile
    }

    pub fn get_agent_profile(&self, account_id: AccountId) -> Option<AgentProfile> {
        self.agent_profiles.get(&account_id)
    }

    pub fn list_agent_profiles(
        &self,
        from_index: Option<u64>,
        limit: Option<u64>,
    ) -> Vec<AgentProfile> {
        let start = from_index.unwrap_or(0) as usize;
        let max = limit.unwrap_or(50).min(100) as usize;
        self.agent_profiles
            .values()
            .skip(start)
            .take(max)
            .collect()
    }

    // =========================================================================
    // 2. CREATE FUNDED MISSION (Enforces criteria_hash == SHA256(criteria_text))
    // =========================================================================

    #[payable]
    pub fn create_job(
        &mut self,
        title: String,
        description: String,
        criteria_text: String,
        criteria_hash: String,
        deadline_ns: U64,
        max_agents: u32,
        role_slots: Option<Vec<RoleSlotInput>>,
        review_window_ns: Option<U64>,
    ) -> Job {
        let deposit = env::attached_deposit().as_yoctonear();
        require!(
            deposit >= MIN_JOB_BUDGET_YOCTO,
            "Attached NEAR deposit must be at least 0.1 NEAR"
        );

        let clean_title = validate_non_empty_bounded(&title, "title", MAX_TITLE_LEN);
        let clean_desc = validate_non_empty_bounded(&description, "description", MAX_DESC_LEN);
        let clean_criteria_text =
            validate_non_empty_bounded(&criteria_text, "criteria_text", MAX_CRITERIA_TEXT_LEN);
        let clean_hash = validate_and_normalize_sha256(&criteria_hash, "criteria_hash");

        // Audit Section 2.7: Recompute SHA-256 of criteria_text inside the contract and verify match.
        let computed_hash = compute_sha256_hex(&clean_criteria_text);
        require!(
            computed_hash == clean_hash,
            format!(
                "criteria_hash ({}) does not match SHA-256 of criteria_text ({})",
                clean_hash, computed_hash
            )
        );

        require!(
            (MIN_CREW_SIZE..=MAX_CREW_SIZE).contains(&max_agents),
            "max_agents must be between 2 and 10 for a multi-agent swarm"
        );

        let now = env::block_timestamp();
        require!(
            deadline_ns.0 > now,
            "deadline_ns must be strictly in the future"
        );

        let rev_window = review_window_ns
            .map(|w| w.0)
            .unwrap_or(DEFAULT_REVIEW_WINDOW_NS);
        require!(
            rev_window >= MIN_REVIEW_WINDOW_NS,
            "review_window_ns must be at least 1 hour in nanoseconds"
        );

        let slots = role_slots.unwrap_or_default();
        require!(
            slots.len() <= MAX_CREW_SIZE as usize,
            "Too many role slots defined"
        );
        let mut clean_slots = Vec::with_capacity(slots.len());
        let mut suggested_sum: u128 = 0;
        for slot in slots {
            let r = validate_non_empty_bounded(&slot.role, "role_slot.role", MAX_ROLE_LEN);
            suggested_sum = suggested_sum
                .checked_add(slot.suggested_payout_yocto.0)
                .expect("Suggested payout overflow");
            clean_slots.push(RoleSlotInput {
                role: r,
                suggested_payout_yocto: slot.suggested_payout_yocto,
            });
        }
        require!(
            suggested_sum <= deposit,
            "Sum of suggested role slot payouts cannot exceed attached escrow budget"
        );

        let job_id = self.next_job_id;
        self.next_job_id += 1;
        let creator = env::predecessor_account_id();

        let job = Job {
            id: job_id,
            creator: creator.clone(),
            title: clean_title.clone(),
            description: clean_desc,
            criteria_text: clean_criteria_text,
            criteria_hash: clean_hash.clone(),
            role_slots: clean_slots,
            deadline_ns,
            review_window_ns: U64(rev_window),
            status: JobStatus::Open,
            budget_yocto: U128(deposit),
            allocated_yocto: U128(0),
            transferred_yocto: U128(0),
            in_flight_yocto: U128(0),
            claimable_pool_yocto: U128(0),
            refunded_yocto: U128(0),
            max_agents,
            selected_agents: Vec::new(),
            created_at_ns: U64(now),
            updated_at_ns: U64(now),
        };

        self.jobs.insert(&job_id, &job);
        self.job_bids.insert(&job_id, &Vec::new());
        self.job_contributions.insert(&job_id, &Vec::new());

        emit_nep297_event(
            "job_created",
            serde_json::json!({
                "job_id": job_id,
                "creator": creator,
                "title": clean_title,
                "criteria_hash": clean_hash,
                "budget_yocto": deposit.to_string(),
                "deadline_ns": deadline_ns.0.to_string(),
                "review_window_ns": rev_window.to_string(),
                "max_agents": max_agents
            }),
        );

        job
    }

    // =========================================================================
    // 3. ROLE-SPECIFIC BIDDING (Enforces Profile, Availability, Min Rate & Role Slot)
    // =========================================================================

    pub fn submit_bid(
        &mut self,
        job_id: u64,
        role: String,
        requested_payout_yocto: U128,
        proposal: String,
        estimated_hours: Option<u32>,
    ) -> Bid {
        let mut job = self.jobs.get(&job_id).expect("Job not found");
        require!(
            job.status == JobStatus::Open,
            "Bids can only be submitted while the job is Open"
        );
        let now = env::block_timestamp();
        require!(
            now < job.deadline_ns.0,
            "Cannot submit a bid after the job deadline"
        );

        let agent = env::predecessor_account_id();
        require!(
            agent != job.creator,
            "Job creator cannot bid on their own job"
        );

        // Audit Section 2.9: Enforce registered & available agent profile and minimum rate.
        let profile = self
            .agent_profiles
            .get(&agent)
            .expect("Bidder must register an AgentProfile before submitting a bid");
        require!(
            profile.available,
            "Bidder's AgentProfile is currently marked as unavailable"
        );
        require!(
            requested_payout_yocto.0 >= profile.min_rate_yocto.0,
            "Requested payout is below the agent's registered min_rate_yocto"
        );
        require!(
            requested_payout_yocto.0 >= MIN_AGENT_PAYOUT_YOCTO,
            "Requested payout must be at least 0.01 NEAR"
        );
        require!(
            requested_payout_yocto.0 <= job.budget_yocto.0,
            "Requested payout cannot exceed total job budget"
        );

        let clean_role = validate_non_empty_bounded(&role, "role", MAX_ROLE_LEN);
        if !job.role_slots.is_empty() {
            require!(
                job.role_slots
                    .iter()
                    .any(|s| s.role.eq_ignore_ascii_case(&clean_role)),
                "Bid role must match one of the job's defined role_slots"
            );
        }

        let clean_proposal = validate_non_empty_bounded(&proposal, "proposal", MAX_PROPOSAL_LEN);
        let est_hours = estimated_hours.unwrap_or(24).clamp(1, 720);

        let mut bids = self.job_bids.get(&job_id).unwrap_or_default();
        require!(
            bids.len() < MAX_BIDS_PER_JOB,
            "Maximum number of bids reached for this job"
        );

        require!(
            !bids
                .iter()
                .any(|b| b.agent == agent && b.status != BidStatus::Withdrawn),
            "Agent has already submitted an active bid for this job"
        );

        let bid = Bid {
            job_id,
            agent: agent.clone(),
            role: clean_role.clone(),
            requested_payout_yocto,
            proposal: clean_proposal,
            estimated_hours: est_hours,
            status: BidStatus::Pending,
            created_at_ns: U64(now),
            updated_at_ns: U64(now),
        };

        bids.push(bid.clone());
        self.job_bids.insert(&job_id, &bids);
        job.updated_at_ns = U64(now);
        self.jobs.insert(&job_id, &job);

        let mut stats = self
            .agent_stats
            .get(&agent)
            .unwrap_or_else(|| AgentStats::new(agent.clone()));
        stats.bids_submitted += 1;
        self.agent_stats.insert(&agent, &stats);

        emit_nep297_event(
            "bid_submitted",
            serde_json::json!({
                "job_id": job_id,
                "agent": agent,
                "role": clean_role,
                "requested_payout_yocto": requested_payout_yocto.0.to_string(),
                "estimated_hours": est_hours
            }),
        );

        bid
    }

    pub fn withdraw_bid(&mut self, job_id: u64) -> Bid {
        let job = self.jobs.get(&job_id).expect("Job not found");
        require!(
            job.status == JobStatus::Open,
            "Can only withdraw a bid while the job is still Open"
        );
        let caller = env::predecessor_account_id();
        let mut bids = self.job_bids.get(&job_id).expect("No bids for job");
        let idx = bids
            .iter()
            .position(|b| b.agent == caller && b.status == BidStatus::Pending)
            .expect("Active pending bid not found for caller");

        bids[idx].status = BidStatus::Withdrawn;
        bids[idx].updated_at_ns = U64(env::block_timestamp());
        let updated = bids[idx].clone();
        self.job_bids.insert(&job_id, &bids);

        emit_nep297_event(
            "bid_withdrawn",
            serde_json::json!({
                "job_id": job_id,
                "agent": caller
            }),
        );
        updated
    }

    // =========================================================================
    // 4. TEMPORARY CREW SELECTION (Enforces Bid Role Match & Min Rate)
    // =========================================================================

    pub fn select_crew(&mut self, job_id: u64, selections: Vec<CrewSelectionInput>) -> Job {
        let mut job = self.jobs.get(&job_id).expect("Job not found");
        let caller = env::predecessor_account_id();
        require!(
            caller == job.creator,
            "Only the job creator can select the crew"
        );
        require!(
            job.status == JobStatus::Open,
            "Crew can only be selected once while job is Open"
        );
        let now = env::block_timestamp();
        require!(
            now < job.deadline_ns.0,
            "Cannot select crew after the job deadline"
        );

        let count = selections.len() as u32;
        require!(
            count >= MIN_CREW_SIZE && count <= job.max_agents,
            format!(
                "Crew size must be between {} and {}",
                MIN_CREW_SIZE, job.max_agents
            )
        );

        let mut bids = self.job_bids.get(&job_id).unwrap_or_default();
        let mut total_allocated: u128 = 0;
        let mut selected_accounts: Vec<AccountId> = Vec::with_capacity(selections.len());
        let mut contributions: Vec<Contribution> = Vec::with_capacity(selections.len());

        for sel in &selections {
            require!(
                sel.agent != job.creator,
                "Creator cannot select themselves as a paid crew member"
            );
            require!(
                !selected_accounts.contains(&sel.agent),
                "Duplicate agent in crew selection is not allowed"
            );
            require!(
                sel.agreed_payout_yocto.0 >= MIN_AGENT_PAYOUT_YOCTO,
                "Each crew member payout must be at least 0.01 NEAR"
            );

            let profile = self
                .agent_profiles
                .get(&sel.agent)
                .expect("Selected agent must have a registered AgentProfile");
            require!(
                sel.agreed_payout_yocto.0 >= profile.min_rate_yocto.0,
                "Agreed payout cannot be below the agent's registered min_rate_yocto"
            );

            let clean_role = validate_non_empty_bounded(&sel.role, "selection.role", MAX_ROLE_LEN);

            let bid_pos = bids
                .iter()
                .position(|b| b.agent == sel.agent && b.status == BidStatus::Pending)
                .expect("Every selected crew member must have an active Pending bid on this job");

            require!(
                bids[bid_pos].role.eq_ignore_ascii_case(&clean_role),
                "Selected role must match the role specified in the agent's bid"
            );

            bids[bid_pos].status = BidStatus::Selected;
            bids[bid_pos].updated_at_ns = U64(now);

            total_allocated = total_allocated
                .checked_add(sel.agreed_payout_yocto.0)
                .expect("Payout allocation overflow");

            selected_accounts.push(sel.agent.clone());
            contributions.push(Contribution {
                job_id,
                agent: sel.agent.clone(),
                role: clean_role,
                agreed_payout_yocto: sel.agreed_payout_yocto,
                artifact_uri: String::new(),
                artifact_sha256: String::new(),
                evidence_notes: String::new(),
                feedback_reason: String::new(),
                status: ContributionStatus::NotSubmitted,
                submission_count: 0,
                revision_count: 0,
                submitted_at_ns: U64(0),
                review_deadline_ns: U64(0),
                resubmit_deadline_ns: job.deadline_ns,
                resolved_at_ns: U64(0),
                verifier_score: None,
                verifier_summary: String::new(),
                verifier_report_sha256: String::new(),
                verifier_audited_criteria_hash: String::new(),
                verifier_audited_artifact_sha256: String::new(),
                verifier_agent: None,
                customer_rating: None,
            });

            let mut stats = self
                .agent_stats
                .get(&sel.agent)
                .unwrap_or_else(|| AgentStats::new(sel.agent.clone()));
            stats.crews_selected += 1;
            self.agent_stats.insert(&sel.agent, &stats);
        }

        require!(
            total_allocated <= job.budget_yocto.0,
            "Total allocated crew payouts cannot exceed the funded escrow budget"
        );

        for bid in bids.iter_mut() {
            if bid.status == BidStatus::Pending {
                bid.status = BidStatus::NotSelected;
                bid.updated_at_ns = U64(now);
            }
        }

        self.job_bids.insert(&job_id, &bids);
        self.job_contributions.insert(&job_id, &contributions);

        job.allocated_yocto = U128(total_allocated);
        job.selected_agents = selected_accounts.clone();
        job.status = JobStatus::CrewSelected;
        job.updated_at_ns = U64(now);
        self.jobs.insert(&job_id, &job);

        emit_nep297_event(
            "crew_selected",
            serde_json::json!({
                "job_id": job_id,
                "selected_agents": selected_accounts,
                "allocated_yocto": total_allocated.to_string(),
                "unallocated_reserve_yocto": (job.budget_yocto.0 - total_allocated).to_string()
            }),
        );

        job
    }

    // =========================================================================
    // 5. EVIDENCE-BOUND DELIVERABLE SUBMISSION & VERIFIER QUALITY SCORING
    // =========================================================================

    pub fn submit_contribution(
        &mut self,
        job_id: u64,
        artifact_uri: String,
        artifact_sha256: String,
        evidence_notes: Option<String>,
    ) -> Contribution {
        let mut job = self.jobs.get(&job_id).expect("Job not found");
        require!(
            job.status == JobStatus::CrewSelected || job.status == JobStatus::InProgress,
            "Job is not in an active work submission state"
        );

        let caller = env::predecessor_account_id();
        let clean_uri = validate_non_empty_bounded(&artifact_uri, "artifact_uri", MAX_URI_LEN);
        let clean_hash = validate_and_normalize_sha256(&artifact_sha256, "artifact_sha256");
        let clean_notes = match evidence_notes {
            Some(n) if !n.trim().is_empty() => {
                validate_non_empty_bounded(&n, "evidence_notes", MAX_NOTES_LEN)
            }
            _ => String::new(),
        };

        let mut contributions = self
            .job_contributions
            .get(&job_id)
            .expect("Contributions not initialized");
        let idx = contributions
            .iter()
            .position(|c| c.agent == caller)
            .expect("Only a selected crew member for this job can submit a contribution");

        // Audit Section 2.1: Reject arbitrary self-resubmission when already `Submitted`
        // so an agent cannot reset `review_deadline_ns` without a creator revision request.
        require!(
            contributions[idx].status == ContributionStatus::NotSubmitted
                || contributions[idx].status == ContributionStatus::RevisionRequested,
            "Deliverable can only be submitted initially or after a creator RevisionRequested"
        );

        let now = env::block_timestamp();
        let allowed_deadline = if contributions[idx].status == ContributionStatus::RevisionRequested
        {
            contributions[idx].resubmit_deadline_ns.0.max(job.deadline_ns.0)
        } else {
            job.deadline_ns.0
        };
        require!(
            now <= allowed_deadline,
            "Cannot submit deliverable after the allowed submission/resubmission deadline"
        );

        let rev_deadline = now
            .checked_add(job.review_window_ns.0)
            .expect("Review deadline timestamp overflow");

        contributions[idx].artifact_uri = clean_uri.clone();
        contributions[idx].artifact_sha256 = clean_hash.clone();
        contributions[idx].evidence_notes = clean_notes;
        contributions[idx].status = ContributionStatus::Submitted;
        contributions[idx].submission_count += 1;
        contributions[idx].submitted_at_ns = U64(now);
        contributions[idx].review_deadline_ns = U64(rev_deadline);
        // Reset verifier score for the new submission round
        contributions[idx].verifier_score = None;
        contributions[idx].verifier_summary.clear();
        contributions[idx].verifier_report_sha256.clear();
        contributions[idx].verifier_audited_criteria_hash.clear();
        contributions[idx].verifier_audited_artifact_sha256.clear();
        contributions[idx].verifier_agent = None;

        let updated_contrib = contributions[idx].clone();
        self.job_contributions.insert(&job_id, &contributions);

        if job.status == JobStatus::CrewSelected {
            job.status = JobStatus::InProgress;
        }
        job.updated_at_ns = U64(now);
        self.jobs.insert(&job_id, &job);

        emit_nep297_event(
            "contribution_submitted",
            serde_json::json!({
                "job_id": job_id,
                "agent": caller,
                "role": updated_contrib.role,
                "artifact_uri": clean_uri,
                "artifact_sha256": clean_hash,
                "submission_count": updated_contrib.submission_count,
                "review_deadline_ns": rev_deadline.to_string()
            }),
        );

        updated_contrib
    }

    /// Advisory on-chain verification score bound to the exact criteria_hash and target artifact_sha256.
    pub fn submit_verifier_score(
        &mut self,
        job_id: u64,
        target_agent_id: AccountId,
        audited_criteria_hash: String,
        audited_artifact_sha256: String,
        quality_score: u8,
        verification_summary: String,
        report_sha256: String,
    ) -> Contribution {
        let job = self.jobs.get(&job_id).expect("Job not found");
        require!(
            job.status == JobStatus::InProgress || job.status == JobStatus::CrewSelected,
            "Job is not in an active state"
        );
        require!(
            quality_score <= 100,
            "quality_score must be between 0 and 100"
        );

        let caller = env::predecessor_account_id();
        require!(
            caller != target_agent_id,
            "An agent cannot submit a verifier score for its own contribution"
        );

        let clean_criteria_hash =
            validate_and_normalize_sha256(&audited_criteria_hash, "audited_criteria_hash");
        require!(
            clean_criteria_hash == job.criteria_hash,
            "audited_criteria_hash does not match the job's committed criteria_hash"
        );

        let clean_artifact_hash =
            validate_and_normalize_sha256(&audited_artifact_sha256, "audited_artifact_sha256");
        let clean_summary =
            validate_non_empty_bounded(&verification_summary, "verification_summary", MAX_REASON_LEN);
        let clean_report_hash = validate_and_normalize_sha256(&report_sha256, "report_sha256");

        let mut contributions = self
            .job_contributions
            .get(&job_id)
            .expect("Contributions not found");

        let is_selected_verifier = contributions.iter().any(|c| {
            c.agent == caller
                && (c.role.to_ascii_lowercase().contains("verif")
                    || c.role.to_ascii_lowercase().contains("audit")
                    || c.role.to_ascii_lowercase().contains("qa"))
        });
        require!(
            is_selected_verifier,
            "Only a selected Verifier/Auditor crew member for this job can record a verifier score"
        );

        let idx = contributions
            .iter()
            .position(|c| c.agent == target_agent_id)
            .expect("Target contributor not found");
        require!(
            contributions[idx].status == ContributionStatus::Submitted,
            "Target contribution must be in Submitted status to be scored"
        );
        require!(
            contributions[idx].artifact_sha256 == clean_artifact_hash,
            "audited_artifact_sha256 does not match the target's currently submitted artifact_sha256"
        );
        require!(
            contributions[idx].verifier_score.is_none(),
            "Verifier score is already recorded for this submission round and cannot be overwritten"
        );

        contributions[idx].verifier_score = Some(quality_score);
        contributions[idx].verifier_summary = clean_summary.clone();
        contributions[idx].verifier_report_sha256 = clean_report_hash.clone();
        contributions[idx].verifier_audited_criteria_hash = clean_criteria_hash.clone();
        contributions[idx].verifier_audited_artifact_sha256 = clean_artifact_hash.clone();
        contributions[idx].verifier_agent = Some(caller.clone());

        let updated = contributions[idx].clone();
        self.job_contributions.insert(&job_id, &contributions);

        emit_nep297_event(
            "verifier_score_recorded",
            serde_json::json!({
                "job_id": job_id,
                "verifier_agent": caller,
                "target_agent": target_agent_id,
                "audited_criteria_hash": clean_criteria_hash,
                "audited_artifact_sha256": clean_artifact_hash,
                "quality_score": quality_score,
                "report_sha256": clean_report_hash,
                "verification_summary": clean_summary
            }),
        );

        updated
    }

    // =========================================================================
    // 6. BOUNDED REVISION, REJECTION, APPROVAL & TIMEOUT AUTO-RELEASE
    // =========================================================================

    pub fn request_revision(
        &mut self,
        job_id: u64,
        agent_id: AccountId,
        feedback: String,
    ) -> Contribution {
        let mut job = self.jobs.get(&job_id).expect("Job not found");
        require!(
            env::predecessor_account_id() == job.creator,
            "Only the job creator can request a revision"
        );
        require!(
            job.status == JobStatus::InProgress || job.status == JobStatus::CrewSelected,
            "Job is not active"
        );

        let now = env::block_timestamp();
        // Audit Section 2.3: Cannot request a revision at or after the job deadline.
        require!(
            now < job.deadline_ns.0,
            "Cannot request a revision at or after the job deadline"
        );

        let clean_feedback = validate_non_empty_bounded(&feedback, "feedback", MAX_REASON_LEN);
        let mut contributions = self
            .job_contributions
            .get(&job_id)
            .expect("Contributions not found");
        let idx = contributions
            .iter()
            .position(|c| c.agent == agent_id)
            .expect("Selected contributor not found");

        require!(
            contributions[idx].status == ContributionStatus::Submitted,
            "Can only request revision on a Submitted contribution"
        );
        // Audit Section 2.2 & 2.4: Creator review actions are only permitted strictly before review_deadline_ns.
        require!(
            now < contributions[idx].review_deadline_ns.0,
            "Creator review window has expired; contribution is now eligible for agent timeout payout"
        );
        // Audit Section 2.5: Enforce maximum revision rounds cap.
        require!(
            contributions[idx].revision_count < MAX_REVISION_ROUNDS,
            "Maximum revision rounds (2) reached for this contribution; creator must approve or reject"
        );

        contributions[idx].status = ContributionStatus::RevisionRequested;
        contributions[idx].revision_count += 1;
        contributions[idx].feedback_reason = clean_feedback.clone();
        // Guarantee agent at least `review_window_ns` (or until `job.deadline_ns`, whichever is later) to resubmit.
        contributions[idx].resubmit_deadline_ns = U64(
            job.deadline_ns
                .0
                .max(now.saturating_add(job.review_window_ns.0)),
        );

        let updated = contributions[idx].clone();
        self.job_contributions.insert(&job_id, &contributions);

        job.updated_at_ns = U64(now);
        self.jobs.insert(&job_id, &job);

        let mut stats = self
            .agent_stats
            .get(&agent_id)
            .unwrap_or_else(|| AgentStats::new(agent_id.clone()));
        stats.revisions_requested += 1;
        self.agent_stats.insert(&agent_id, &stats);

        emit_nep297_event(
            "revision_requested",
            serde_json::json!({
                "job_id": job_id,
                "agent": agent_id,
                "revision_count": updated.revision_count,
                "resubmit_deadline_ns": updated.resubmit_deadline_ns.0.to_string(),
                "feedback": clean_feedback
            }),
        );

        updated
    }

    pub fn reject_contribution(
        &mut self,
        job_id: u64,
        agent_id: AccountId,
        reason: String,
    ) -> Contribution {
        let mut job = self.jobs.get(&job_id).expect("Job not found");
        require!(
            env::predecessor_account_id() == job.creator,
            "Only the job creator can reject a contribution"
        );
        require!(
            job.status == JobStatus::InProgress || job.status == JobStatus::CrewSelected,
            "Job is not in an active state"
        );

        let clean_reason = validate_non_empty_bounded(&reason, "reason", MAX_REASON_LEN);
        let mut contributions = self
            .job_contributions
            .get(&job_id)
            .expect("Contributions not found");
        let idx = contributions
            .iter()
            .position(|c| c.agent == agent_id)
            .expect("Selected contributor not found");

        require!(
            contributions[idx].status == ContributionStatus::Submitted,
            "Only a Submitted contribution can be rejected by the creator"
        );

        let now = env::block_timestamp();
        // Audit Section 2.4: Creator rejection is only allowed strictly before review_deadline_ns.
        require!(
            now < contributions[idx].review_deadline_ns.0,
            "Creator review window has expired; cannot reject after review_deadline_ns"
        );

        contributions[idx].status = ContributionStatus::Rejected;
        contributions[idx].feedback_reason = clean_reason.clone();
        contributions[idx].resolved_at_ns = U64(now);
        let updated = contributions[idx].clone();
        self.job_contributions.insert(&job_id, &contributions);

        let mut stats = self
            .agent_stats
            .get(&agent_id)
            .unwrap_or_else(|| AgentStats::new(agent_id.clone()));
        stats.rejected_contributions += 1;
        self.agent_stats.insert(&agent_id, &stats);

        self.check_and_finalize_job_if_all_resolved(&mut job, &contributions, now);
        self.jobs.insert(&job_id, &job);

        emit_nep297_event(
            "contribution_rejected",
            serde_json::json!({
                "job_id": job_id,
                "agent": agent_id,
                "reason": clean_reason
            }),
        );

        updated
    }

    pub fn approve_contribution(
        &mut self,
        job_id: u64,
        agent_id: AccountId,
        rating: Option<u8>,
    ) -> Promise {
        let mut job = self.jobs.get(&job_id).expect("Job not found");
        require!(
            env::predecessor_account_id() == job.creator,
            "Only the job creator can approve a contribution"
        );
        require!(
            job.status == JobStatus::InProgress || job.status == JobStatus::CrewSelected,
            "Job is not in an active state"
        );

        if let Some(stars) = rating {
            require!(
                (1..=5).contains(&stars),
                "Customer rating must be between 1 and 5 stars"
            );
        }

        let mut contributions = self
            .job_contributions
            .get(&job_id)
            .expect("Contributions not found");
        let idx = contributions
            .iter()
            .position(|c| c.agent == agent_id)
            .expect("Selected contributor not found");

        require!(
            contributions[idx].status == ContributionStatus::Submitted,
            "Contribution must be in Submitted status with evidence before approval"
        );

        let now = env::block_timestamp();
        // Audit Section 2.4: Creator approval is allowed strictly before review_deadline_ns
        // (at/after review_deadline_ns, the agent timeout path governs settlement).
        require!(
            now < contributions[idx].review_deadline_ns.0,
            "Creator review window has expired; agent can now claim via claim_timeout_payout"
        );

        let payout_yocto = contributions[idx].agreed_payout_yocto.0;
        let committed_outflows = job
            .transferred_yocto
            .0
            .checked_add(job.in_flight_yocto.0)
            .and_then(|v| v.checked_add(job.claimable_pool_yocto.0))
            .and_then(|v| v.checked_add(job.refunded_yocto.0))
            .and_then(|v| v.checked_add(payout_yocto))
            .expect("Outflow arithmetic overflow");

        require!(
            committed_outflows <= job.budget_yocto.0,
            "Approving this payout would exceed the funded escrow budget"
        );

        contributions[idx].status = ContributionStatus::PayoutPending;
        contributions[idx].resolved_at_ns = U64(now);
        contributions[idx].customer_rating = rating;
        self.job_contributions.insert(&job_id, &contributions);

        if let Some(stars) = rating {
            let mut stats = self
                .agent_stats
                .get(&agent_id)
                .unwrap_or_else(|| AgentStats::new(agent_id.clone()));
            stats.rating_sum += stars as u32;
            stats.rating_count += 1;
            self.agent_stats.insert(&agent_id, &stats);
        }

        job.in_flight_yocto = U128(job.in_flight_yocto.0 + payout_yocto);
        job.updated_at_ns = U64(now);
        self.jobs.insert(&job_id, &job);

        emit_nep297_event(
            "contribution_approval_initiated",
            serde_json::json!({
                "job_id": job_id,
                "agent": agent_id,
                "agreed_payout_yocto": payout_yocto.to_string(),
                "artifact_sha256": contributions[idx].artifact_sha256,
                "customer_rating": rating
            }),
        );

        Promise::new(agent_id.clone())
            .transfer(NearToken::from_yoctonear(payout_yocto))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_payout_complete(job_id, agent_id, U128(payout_yocto), false),
            )
    }

    pub fn claim_timeout_payout(&mut self, job_id: u64, agent_id: Option<AccountId>) -> Promise {
        let mut job = self.jobs.get(&job_id).expect("Job not found");
        require!(
            job.status == JobStatus::InProgress || job.status == JobStatus::CrewSelected,
            "Job is not in an active state"
        );

        let caller = env::predecessor_account_id();
        let target_agent = agent_id.unwrap_or_else(|| caller.clone());
        require!(
            caller == target_agent,
            "Only the submitting agent can claim their timeout payout"
        );

        let mut contributions = self
            .job_contributions
            .get(&job_id)
            .expect("Contributions not found");
        let idx = contributions
            .iter()
            .position(|c| c.agent == target_agent)
            .expect("Selected contributor not found");

        require!(
            contributions[idx].status == ContributionStatus::Submitted,
            "Contribution must be in Submitted status to claim review-timeout payout"
        );

        let now = env::block_timestamp();
        require!(
            contributions[idx].review_deadline_ns.0 > 0
                && now >= contributions[idx].review_deadline_ns.0,
            "Creator review window has not expired yet"
        );

        let payout_yocto = contributions[idx].agreed_payout_yocto.0;
        let committed_outflows = job
            .transferred_yocto
            .0
            .checked_add(job.in_flight_yocto.0)
            .and_then(|v| v.checked_add(job.claimable_pool_yocto.0))
            .and_then(|v| v.checked_add(job.refunded_yocto.0))
            .and_then(|v| v.checked_add(payout_yocto))
            .expect("Outflow arithmetic overflow");

        require!(
            committed_outflows <= job.budget_yocto.0,
            "Timeout payout would exceed the funded escrow budget"
        );

        contributions[idx].status = ContributionStatus::PayoutPending;
        contributions[idx].resolved_at_ns = U64(now);
        self.job_contributions.insert(&job_id, &contributions);

        job.in_flight_yocto = U128(job.in_flight_yocto.0 + payout_yocto);
        job.updated_at_ns = U64(now);
        self.jobs.insert(&job_id, &job);

        emit_nep297_event(
            "timeout_auto_release_initiated",
            serde_json::json!({
                "job_id": job_id,
                "agent": target_agent,
                "agreed_payout_yocto": payout_yocto.to_string(),
                "review_deadline_ns": contributions[idx].review_deadline_ns.0.to_string(),
                "claimed_at_ns": now.to_string()
            }),
        );

        Promise::new(target_agent.clone())
            .transfer(NearToken::from_yoctonear(payout_yocto))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_payout_complete(job_id, target_agent, U128(payout_yocto), true),
            )
    }

    #[private]
    pub fn on_payout_complete(
        &mut self,
        job_id: u64,
        agent_id: AccountId,
        amount_yocto: U128,
        was_timeout_claim: bool,
        #[callback_result] call_result: Result<(), PromiseError>,
    ) -> bool {
        let mut job = self.jobs.get(&job_id).expect("Job not found in callback");
        let mut contributions = self
            .job_contributions
            .get(&job_id)
            .expect("Contributions not found in callback");
        let idx = contributions
            .iter()
            .position(|c| c.agent == agent_id)
            .expect("Contributor not found in callback");

        let now = env::block_timestamp();
        job.in_flight_yocto = U128(job.in_flight_yocto.0.saturating_sub(amount_yocto.0));

        let submitted_on_time = contributions[idx].submitted_at_ns.0 <= job.deadline_ns.0;
        let transfer_succeeded = call_result.is_ok();
        let mut stats = self
            .agent_stats
            .get(&agent_id)
            .unwrap_or_else(|| AgentStats::new(agent_id.clone()));
        stats.accepted_contributions += 1;
        if submitted_on_time {
            stats.on_time_deliveries += 1;
        }
        if was_timeout_claim {
            stats.timeout_claims += 1;
        }

        if transfer_succeeded {
            // Audit Section 2.11: Only increment transferred_yocto and total_earned_yocto when transfer succeeds!
            job.transferred_yocto = U128(
                job.transferred_yocto
                    .0
                    .checked_add(amount_yocto.0)
                    .expect("transferred_yocto overflow"),
            );
            contributions[idx].status = ContributionStatus::Paid;
            contributions[idx].resolved_at_ns = U64(now);
            stats.total_earned_yocto = U128(
                stats
                    .total_earned_yocto
                    .0
                    .checked_add(amount_yocto.0)
                    .expect("total_earned overflow"),
            );
            emit_nep297_event(
                "payout_completed",
                serde_json::json!({
                    "job_id": job_id,
                    "agent": agent_id,
                    "transferred_yocto": amount_yocto.0.to_string(),
                    "was_timeout_claim": was_timeout_claim
                }),
            );
        } else {
            // Queue in claimable_pool_yocto; do NOT report as transferred until withdrawn!
            job.claimable_pool_yocto = U128(
                job.claimable_pool_yocto
                    .0
                    .checked_add(amount_yocto.0)
                    .expect("claimable_pool overflow"),
            );
            contributions[idx].status = ContributionStatus::ApprovedClaimable;
            contributions[idx].resolved_at_ns = U64(now);
            let current_claimable = self.claimable_payouts.get(&agent_id).unwrap_or(0);
            self.claimable_payouts
                .insert(&agent_id, &(current_claimable + amount_yocto.0));
            emit_nep297_event(
                "payout_fallback_queued",
                serde_json::json!({
                    "job_id": job_id,
                    "agent": agent_id,
                    "claimable_yocto": amount_yocto.0.to_string()
                }),
            );
        }

        self.agent_stats.insert(&agent_id, &stats);
        self.job_contributions.insert(&job_id, &contributions);
        self.check_and_finalize_job_if_all_resolved(&mut job, &contributions, now);
        self.jobs.insert(&job_id, &job);

        transfer_succeeded
    }

    pub fn withdraw_claimable_payout(&mut self, job_id: Option<u64>) -> Promise {
        let caller = env::predecessor_account_id();
        let amount = self.claimable_payouts.get(&caller).unwrap_or(0);
        require!(amount > 0, "No claimable payout balance available");

        self.claimable_payouts.insert(&caller, &0);

        Promise::new(caller.clone())
            .transfer(NearToken::from_yoctonear(amount))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_claimable_withdrawal_complete(job_id, caller, U128(amount), false),
            )
    }

    #[private]
    pub fn on_claimable_withdrawal_complete(
        &mut self,
        job_id: Option<u64>,
        beneficiary: AccountId,
        amount_yocto: U128,
        was_creator_refund: bool,
        #[callback_result] call_result: Result<(), PromiseError>,
    ) -> bool {
        if call_result.is_ok() {
            if let Some(jid) = job_id {
                if let Some(mut job) = self.jobs.get(&jid) {
                    job.claimable_pool_yocto =
                        U128(job.claimable_pool_yocto.0.saturating_sub(amount_yocto.0));
                    if was_creator_refund {
                        job.refunded_yocto = U128(job.refunded_yocto.0 + amount_yocto.0);
                    } else {
                        job.transferred_yocto = U128(job.transferred_yocto.0 + amount_yocto.0);
                        if let Some(mut contribs) = self.job_contributions.get(&jid) {
                            if let Some(c) = contribs.iter_mut().find(|c| c.agent == beneficiary) {
                                if c.status == ContributionStatus::ApprovedClaimable {
                                    c.status = ContributionStatus::Paid;
                                }
                            }
                            self.job_contributions.insert(&jid, &contribs);
                        }
                    }
                    self.jobs.insert(&jid, &job);
                }
            }
            if !was_creator_refund {
                if let Some(mut stats) = self.agent_stats.get(&beneficiary) {
                    stats.total_earned_yocto =
                        U128(stats.total_earned_yocto.0 + amount_yocto.0);
                    self.agent_stats.insert(&beneficiary, &stats);
                }
            }
            emit_nep297_event(
                "claimable_payout_withdrawn",
                serde_json::json!({
                    "beneficiary": beneficiary,
                    "transferred_yocto": amount_yocto.0.to_string()
                }),
            );
            true
        } else {
            let existing = self.claimable_payouts.get(&beneficiary).unwrap_or(0);
            self.claimable_payouts
                .insert(&beneficiary, &(existing + amount_yocto.0));
            false
        }
    }

    // =========================================================================
    // 7. CANCELLATION & SAFE REMAINING ESCROW REFUND (With Terminal Expiry)
    // =========================================================================

    pub fn cancel_job(&mut self, job_id: u64) -> Promise {
        let mut job = self.jobs.get(&job_id).expect("Job not found");
        require!(
            env::predecessor_account_id() == job.creator,
            "Only the job creator can cancel the job"
        );
        require!(
            job.status == JobStatus::Open,
            "Job can only be cancelled while Open before crew selection begins"
        );
        require!(
            job.in_flight_yocto.0 == 0
                && job.refunded_yocto.0 == 0
                && job.transferred_yocto.0 == 0
                && job.claimable_pool_yocto.0 == 0,
            "Escrow already has outflows or pending operations"
        );

        let refund_amount = job.budget_yocto.0;
        let now = env::block_timestamp();
        job.status = JobStatus::Cancelled;
        job.in_flight_yocto = U128(refund_amount);
        job.updated_at_ns = U64(now);
        self.jobs.insert(&job_id, &job);

        Promise::new(job.creator.clone())
            .transfer(NearToken::from_yoctonear(refund_amount))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_refund_complete(job_id, job.creator, U128(refund_amount), true),
            )
    }

    pub fn claim_remaining_refund(&mut self, job_id: u64) -> Promise {
        let mut job = self.jobs.get(&job_id).expect("Job not found");
        require!(
            env::predecessor_account_id() == job.creator,
            "Only the job creator can claim the remaining refund"
        );
        require!(
            job.status != JobStatus::Open && job.status != JobStatus::Cancelled,
            "Use cancel_job for an Open job; Cancelled jobs are already refunded"
        );
        require!(
            job.in_flight_yocto.0 == 0,
            "Cannot claim refund while a payout or refund promise is in flight"
        );

        let now = env::block_timestamp();
        let mut contributions = self
            .job_contributions
            .get(&job_id)
            .expect("Contributions not found");

        let is_past_deadline = now >= job.deadline_ns.0;

        // Audit Section 2.6: Convert unsubmitted/expired-revision shares into terminal `Expired` state after deadline.
        if is_past_deadline {
            for c in contributions.iter_mut() {
                if c.status == ContributionStatus::NotSubmitted
                    || (c.status == ContributionStatus::RevisionRequested
                        && now > c.resubmit_deadline_ns.0)
                {
                    c.status = ContributionStatus::Expired;
                    c.resolved_at_ns = U64(now);
                    let mut stats = self
                        .agent_stats
                        .get(&c.agent)
                        .unwrap_or_else(|| AgentStats::new(c.agent.clone()));
                    stats.expired_contributions += 1;
                    self.agent_stats.insert(&c.agent, &stats);
                }
            }
            self.job_contributions.insert(&job_id, &contributions);
        }

        let all_resolved = contributions.iter().all(|c| {
            matches!(
                c.status,
                ContributionStatus::Paid
                    | ContributionStatus::ApprovedClaimable
                    | ContributionStatus::Rejected
                    | ContributionStatus::Expired
            )
        });

        require!(
            all_resolved || is_past_deadline,
            "Remaining refund can only be claimed after all crew contributions are resolved or after the deadline"
        );

        let mut locked_for_submitted_or_paid: u128 = 0;
        for c in &contributions {
            match c.status {
                ContributionStatus::Paid
                | ContributionStatus::ApprovedClaimable
                | ContributionStatus::PayoutPending
                | ContributionStatus::Submitted => {
                    locked_for_submitted_or_paid = locked_for_submitted_or_paid
                        .checked_add(c.agreed_payout_yocto.0)
                        .expect("Locked calculation overflow");
                }
                ContributionStatus::RevisionRequested => {
                    // Protected if still within allowed resubmission window
                    if now <= c.resubmit_deadline_ns.0 {
                        locked_for_submitted_or_paid = locked_for_submitted_or_paid
                            .checked_add(c.agreed_payout_yocto.0)
                            .expect("Locked calculation overflow");
                    }
                }
                ContributionStatus::NotSubmitted => {
                    if !is_past_deadline {
                        locked_for_submitted_or_paid = locked_for_submitted_or_paid
                            .checked_add(c.agreed_payout_yocto.0)
                            .expect("Locked calculation overflow");
                    }
                }
                ContributionStatus::Rejected | ContributionStatus::Expired => {}
            }
        }

        let max_refundable = job
            .budget_yocto
            .0
            .saturating_sub(locked_for_submitted_or_paid)
            .saturating_sub(job.refunded_yocto.0);

        require!(
            max_refundable > 0,
            "No refundable escrow balance is currently available to claim"
        );

        let total_after_refund = job
            .transferred_yocto
            .0
            .checked_add(job.claimable_pool_yocto.0)
            .and_then(|v| v.checked_add(job.refunded_yocto.0))
            .and_then(|v| v.checked_add(max_refundable))
            .expect("Refund check overflow");
        require!(
            total_after_refund <= job.budget_yocto.0,
            "Total payouts plus refunds cannot exceed funded escrow budget"
        );

        self.check_and_finalize_job_if_all_resolved(&mut job, &contributions, now);
        job.in_flight_yocto = U128(max_refundable);
        job.updated_at_ns = U64(now);
        self.jobs.insert(&job_id, &job);

        Promise::new(job.creator.clone())
            .transfer(NearToken::from_yoctonear(max_refundable))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_refund_complete(job_id, job.creator, U128(max_refundable), false),
            )
    }

    #[private]
    pub fn on_refund_complete(
        &mut self,
        job_id: u64,
        creator_id: AccountId,
        amount_yocto: U128,
        was_cancellation: bool,
        #[callback_result] call_result: Result<(), PromiseError>,
    ) -> bool {
        let mut job = self.jobs.get(&job_id).expect("Job not found in refund callback");
        job.in_flight_yocto = U128(job.in_flight_yocto.0.saturating_sub(amount_yocto.0));
        job.updated_at_ns = U64(env::block_timestamp());

        if call_result.is_ok() {
            job.refunded_yocto = U128(
                job.refunded_yocto
                    .0
                    .checked_add(amount_yocto.0)
                    .expect("refunded_yocto overflow"),
            );
            self.jobs.insert(&job_id, &job);
            emit_nep297_event(
                if was_cancellation {
                    "job_cancelled_and_refunded"
                } else {
                    "remaining_escrow_refunded"
                },
                serde_json::json!({
                    "job_id": job_id,
                    "creator": creator_id,
                    "refunded_yocto": amount_yocto.0.to_string(),
                    "total_refunded_yocto": job.refunded_yocto.0.to_string()
                }),
            );
            true
        } else {
            job.claimable_pool_yocto = U128(
                job.claimable_pool_yocto
                    .0
                    .checked_add(amount_yocto.0)
                    .expect("claimable_pool overflow"),
            );
            self.jobs.insert(&job_id, &job);
            let existing = self.claimable_payouts.get(&creator_id).unwrap_or(0);
            self.claimable_payouts
                .insert(&creator_id, &(existing + amount_yocto.0));
            emit_nep297_event(
                "refund_fallback_queued",
                serde_json::json!({
                    "job_id": job_id,
                    "creator": creator_id,
                    "claimable_yocto": amount_yocto.0.to_string()
                }),
            );
            false
        }
    }

    fn check_and_finalize_job_if_all_resolved(
        &mut self,
        job: &mut Job,
        contributions: &[Contribution],
        now: u64,
    ) {
        if contributions.is_empty() {
            return;
        }
        let all_terminal = contributions.iter().all(|c| {
            matches!(
                c.status,
                ContributionStatus::Paid
                    | ContributionStatus::ApprovedClaimable
                    | ContributionStatus::Rejected
                    | ContributionStatus::Expired
            )
        });
        if all_terminal && job.status != JobStatus::Completed {
            job.status = JobStatus::Completed;
            job.updated_at_ns = U64(now);

            for c in contributions {
                if matches!(
                    c.status,
                    ContributionStatus::Paid | ContributionStatus::ApprovedClaimable
                ) {
                    let mut stats = self
                        .agent_stats
                        .get(&c.agent)
                        .unwrap_or_else(|| AgentStats::new(c.agent.clone()));
                    stats.jobs_completed += 1;
                    self.agent_stats.insert(&c.agent, &stats);
                }
            }

            emit_nep297_event(
                "job_completed",
                serde_json::json!({
                    "job_id": job.id,
                    "transferred_yocto": job.transferred_yocto.0.to_string(),
                    "claimable_pool_yocto": job.claimable_pool_yocto.0.to_string(),
                    "allocated_yocto": job.allocated_yocto.0.to_string(),
                    "budget_yocto": job.budget_yocto.0.to_string()
                }),
            );
        }
    }

    // =========================================================================
    // 8. VIEW METHODS
    // =========================================================================

    pub fn get_job(&self, job_id: u64) -> Option<Job> {
        self.jobs.get(&job_id)
    }

    pub fn list_jobs(&self, from_index: Option<u64>, limit: Option<u64>) -> Vec<Job> {
        let start = from_index.unwrap_or(0) as usize;
        let max = limit.unwrap_or(25).min(100) as usize;
        self.jobs.values().skip(start).take(max).collect()
    }

    pub fn list_bids(&self, job_id: u64, from_index: Option<u64>, limit: Option<u64>) -> Vec<Bid> {
        let start = from_index.unwrap_or(0) as usize;
        let max = limit.unwrap_or(50).min(MAX_BIDS_PER_JOB) as usize;
        self.job_bids
            .get(&job_id)
            .unwrap_or_default()
            .into_iter()
            .skip(start)
            .take(max)
            .collect()
    }

    pub fn list_contributions(&self, job_id: u64) -> Vec<Contribution> {
        self.job_contributions.get(&job_id).unwrap_or_default()
    }

    pub fn get_agent_stats(&self, account_id: AccountId) -> AgentStats {
        self.agent_stats
            .get(&account_id)
            .unwrap_or_else(|| AgentStats::new(account_id))
    }

    pub fn get_claimable_payout(&self, account_id: AccountId) -> U128 {
        U128(self.claimable_payouts.get(&account_id).unwrap_or(0))
    }

    pub fn get_job_treasury(&self, job_id: u64) -> Option<JobTreasurySummary> {
        let job = self.jobs.get(&job_id)?;
        let contributions = self.job_contributions.get(&job_id).unwrap_or_default();
        let now = env::block_timestamp();
        let is_past_deadline = now >= job.deadline_ns.0;

        let mut locked_active: u128 = 0;
        let mut released_total: u128 = 0;
        let mut locked_for_refund_calc: u128 = 0;

        for c in &contributions {
            match c.status {
                ContributionStatus::Rejected | ContributionStatus::Expired => {
                    released_total += c.agreed_payout_yocto.0;
                }
                ContributionStatus::Paid | ContributionStatus::ApprovedClaimable => {
                    locked_for_refund_calc += c.agreed_payout_yocto.0;
                }
                ContributionStatus::PayoutPending | ContributionStatus::Submitted => {
                    locked_active += c.agreed_payout_yocto.0;
                    locked_for_refund_calc += c.agreed_payout_yocto.0;
                }
                ContributionStatus::RevisionRequested => {
                    if now <= c.resubmit_deadline_ns.0 {
                        locked_active += c.agreed_payout_yocto.0;
                        locked_for_refund_calc += c.agreed_payout_yocto.0;
                    } else {
                        released_total += c.agreed_payout_yocto.0;
                    }
                }
                ContributionStatus::NotSubmitted => {
                    if !is_past_deadline {
                        locked_active += c.agreed_payout_yocto.0;
                        locked_for_refund_calc += c.agreed_payout_yocto.0;
                    } else {
                        released_total += c.agreed_payout_yocto.0;
                    }
                }
            }
        }

        let unallocated_reserve = job.budget_yocto.0.saturating_sub(job.allocated_yocto.0);
        let all_resolved = !contributions.is_empty()
            && contributions.iter().all(|c| {
                matches!(
                    c.status,
                    ContributionStatus::Paid
                        | ContributionStatus::ApprovedClaimable
                        | ContributionStatus::Rejected
                        | ContributionStatus::Expired
                )
            });

        let currently_refundable = if job.status == JobStatus::Open {
            job.budget_yocto.0.saturating_sub(job.refunded_yocto.0)
        } else if (all_resolved || is_past_deadline)
            && job.status != JobStatus::Cancelled
            && job.in_flight_yocto.0 == 0
        {
            job.budget_yocto
                .0
                .saturating_sub(locked_for_refund_calc)
                .saturating_sub(job.refunded_yocto.0)
        } else {
            0
        };

        Some(JobTreasurySummary {
            job_id: job.id,
            status: job.status,
            budget_yocto: job.budget_yocto,
            allocated_yocto: job.allocated_yocto,
            unallocated_reserve_yocto: U128(unallocated_reserve),
            transferred_yocto: job.transferred_yocto,
            in_flight_yocto: job.in_flight_yocto,
            claimable_pool_yocto: job.claimable_pool_yocto,
            locked_for_active_work_yocto: U128(locked_active),
            released_from_rejections_or_expiry_yocto: U128(released_total),
            refunded_yocto: job.refunded_yocto,
            currently_refundable_yocto: U128(currently_refundable),
        })
    }
}

// =============================================================================
// 9. DIRECT RUST UNIT TEST SUITE (32 Tests Matching Section 5 Required Matrix)
// =============================================================================
#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    const ONE_NEAR: u128 = 1_000_000_000_000_000_000_000_000;
    const CRITERIA_TEXT: &str =
        "1. Market & 5 Competitors\n2. Pricing & Profitability\n3. Independent QA Audit";
    const ARTIFACT_HASH_1: &str =
        "f0e1d2c3b4a5968778695a4b3c2d1e0ff0e1d2c3b4a5968778695a4b3c2d1e0f";
    const ARTIFACT_HASH_2: &str =
        "11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff";
    const REPORT_HASH_1: &str =
        "99887766554433221100ffeeddccbbaa99887766554433221100ffeeddccbbaa";

    fn account(name: &str) -> AccountId {
        name.parse().unwrap()
    }

    fn set_context(predecessor: &str, deposit_yocto: u128, timestamp_ns: u64) {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id(account("swarmsettle.testnet"))
            .predecessor_account_id(account(predecessor))
            .attached_deposit(NearToken::from_yoctonear(deposit_yocto))
            .block_timestamp(timestamp_ns);
        testing_env!(builder.build());
    }

    fn register_three_agents(contract: &mut SwarmSettleContract) {
        for (acct, name, role, min_near) in [
            ("researchpro.testnet", "ResearchPro", "Research Specialist", 2),
            ("marketmind.testnet", "MarketMind", "Business Analyst", 2),
            ("verifyai.testnet", "VerifyAI", "Quality Auditor", 1),
        ] {
            set_context(acct, 0, 500_000_000);
            contract.register_agent_profile(
                name.to_string(),
                role.to_string(),
                Some(format!("{} specialist", role)),
                vec![role.to_string()],
                format!("https://swarmsettle.org/agents/{}", acct),
                U128(min_near * ONE_NEAR),
                Some(account("operator.testnet")),
                Some(true),
            );
        }
    }

    fn setup_funded_job(contract: &mut SwarmSettleContract) -> u64 {
        register_three_agents(contract);
        set_context("customer.testnet", 10 * ONE_NEAR, 1_000_000_000);
        let criteria_hash = compute_sha256_hex(CRITERIA_TEXT);
        let job = contract.create_job(
            "Online Coffee Business Launch Strategy".to_string(),
            "Complete launch strategy.".to_string(),
            CRITERIA_TEXT.to_string(),
            criteria_hash,
            U64(500_000_000_000_000),
            3,
            Some(vec![
                RoleSlotInput {
                    role: "Research Specialist".to_string(),
                    suggested_payout_yocto: U128(3 * ONE_NEAR),
                },
                RoleSlotInput {
                    role: "Business Analyst".to_string(),
                    suggested_payout_yocto: U128(3 * ONE_NEAR),
                },
                RoleSlotInput {
                    role: "Quality Auditor".to_string(),
                    suggested_payout_yocto: U128(2 * ONE_NEAR),
                },
            ]),
            Some(U64(DEFAULT_REVIEW_WINDOW_NS)),
        );
        job.id
    }

    #[test]
    fn test_01_create_job_verifies_criteria_sha256_match() {
        let mut contract = SwarmSettleContract::new();
        let job_id = setup_funded_job(&mut contract);
        let job = contract.get_job(job_id).unwrap();
        assert_eq!(job.criteria_hash, compute_sha256_hex(CRITERIA_TEXT));
    }

    #[test]
    #[should_panic(expected = "does not match SHA-256 of criteria_text")]
    fn test_02_reject_criteria_text_and_hash_mismatch() {
        let mut contract = SwarmSettleContract::new();
        set_context("customer.testnet", 5 * ONE_NEAR, 1_000_000_000);
        contract.create_job(
            "Mismatch".to_string(),
            "Desc".to_string(),
            CRITERIA_TEXT.to_string(),
            ARTIFACT_HASH_1.to_string(),
            U64(500_000_000_000_000),
            2,
            None,
            None,
        );
    }

    #[test]
    #[should_panic(expected = "Deliverable can only be submitted initially or after a creator RevisionRequested")]
    fn test_03_reject_arbitrary_self_resubmission_while_submitted() {
        let mut contract = SwarmSettleContract::new();
        let job_id = setup_funded_job(&mut contract);
        set_context("researchpro.testnet", 0, 2_000_000_000);
        contract.submit_bid(job_id, "Research Specialist".to_string(), U128(3 * ONE_NEAR), "Bid".to_string(), None);
        set_context("verifyai.testnet", 0, 2_000_000_000);
        contract.submit_bid(job_id, "Quality Auditor".to_string(), U128(2 * ONE_NEAR), "Bid".to_string(), None);
        set_context("customer.testnet", 0, 3_000_000_000);
        contract.select_crew(
            job_id,
            vec![
                CrewSelectionInput { agent: account("researchpro.testnet"), role: "Research Specialist".to_string(), agreed_payout_yocto: U128(3 * ONE_NEAR) },
                CrewSelectionInput { agent: account("verifyai.testnet"), role: "Quality Auditor".to_string(), agreed_payout_yocto: U128(2 * ONE_NEAR) },
            ],
        );
        set_context("researchpro.testnet", 0, 4_000_000_000);
        contract.submit_contribution(job_id, "https://example.org/a1".to_string(), ARTIFACT_HASH_1.to_string(), None);
        // Arbitrary second submission without RevisionRequested must panic
        contract.submit_contribution(job_id, "https://example.org/a2".to_string(), ARTIFACT_HASH_2.to_string(), None);
    }

    #[test]
    #[should_panic(expected = "Creator review window has expired")]
    fn test_04_reject_late_revision_after_review_deadline() {
        let mut contract = SwarmSettleContract::new();
        let job_id = setup_funded_job(&mut contract);
        set_context("researchpro.testnet", 0, 2_000_000_000);
        contract.submit_bid(job_id, "Research Specialist".to_string(), U128(3 * ONE_NEAR), "Bid".to_string(), None);
        set_context("verifyai.testnet", 0, 2_000_000_000);
        contract.submit_bid(job_id, "Quality Auditor".to_string(), U128(2 * ONE_NEAR), "Bid".to_string(), None);
        set_context("customer.testnet", 0, 3_000_000_000);
        contract.select_crew(
            job_id,
            vec![
                CrewSelectionInput { agent: account("researchpro.testnet"), role: "Research Specialist".to_string(), agreed_payout_yocto: U128(3 * ONE_NEAR) },
                CrewSelectionInput { agent: account("verifyai.testnet"), role: "Quality Auditor".to_string(), agreed_payout_yocto: U128(2 * ONE_NEAR) },
            ],
        );
        let submit_ts = 10_000_000_000;
        set_context("researchpro.testnet", 0, submit_ts);
        contract.submit_contribution(job_id, "https://example.org/a1".to_string(), ARTIFACT_HASH_1.to_string(), None);
        // Creator tries to request revision AFTER 48h review window elapsed
        set_context("customer.testnet", 0, submit_ts + DEFAULT_REVIEW_WINDOW_NS);
        contract.request_revision(job_id, account("researchpro.testnet"), "Too late".to_string());
    }

    #[test]
    #[should_panic(expected = "Maximum revision rounds (2) reached")]
    fn test_05_enforce_max_revision_rounds_cap() {
        let mut contract = SwarmSettleContract::new();
        let job_id = setup_funded_job(&mut contract);
        set_context("researchpro.testnet", 0, 2_000_000_000);
        contract.submit_bid(job_id, "Research Specialist".to_string(), U128(3 * ONE_NEAR), "Bid".to_string(), None);
        set_context("verifyai.testnet", 0, 2_000_000_000);
        contract.submit_bid(job_id, "Quality Auditor".to_string(), U128(2 * ONE_NEAR), "Bid".to_string(), None);
        set_context("customer.testnet", 0, 3_000_000_000);
        contract.select_crew(
            job_id,
            vec![
                CrewSelectionInput { agent: account("researchpro.testnet"), role: "Research Specialist".to_string(), agreed_payout_yocto: U128(3 * ONE_NEAR) },
                CrewSelectionInput { agent: account("verifyai.testnet"), role: "Quality Auditor".to_string(), agreed_payout_yocto: U128(2 * ONE_NEAR) },
            ],
        );
        // Round 1
        set_context("researchpro.testnet", 0, 10_000_000_000);
        contract.submit_contribution(job_id, "https://example.org/v1".to_string(), ARTIFACT_HASH_1.to_string(), None);
        set_context("customer.testnet", 0, 11_000_000_000);
        contract.request_revision(job_id, account("researchpro.testnet"), "Rev 1".to_string());
        // Round 2
        set_context("researchpro.testnet", 0, 12_000_000_000);
        contract.submit_contribution(job_id, "https://example.org/v2".to_string(), ARTIFACT_HASH_2.to_string(), None);
        set_context("customer.testnet", 0, 13_000_000_000);
        contract.request_revision(job_id, account("researchpro.testnet"), "Rev 2".to_string());
        // Round 3 submission -> 3rd revision request must panic
        set_context("researchpro.testnet", 0, 14_000_000_000);
        contract.submit_contribution(job_id, "https://example.org/v3".to_string(), ARTIFACT_HASH_1.to_string(), None);
        set_context("customer.testnet", 0, 15_000_000_000);
        contract.request_revision(job_id, account("researchpro.testnet"), "Rev 3 not allowed".to_string());
    }

    #[test]
    #[should_panic(expected = "Attached NEAR deposit must be at least 0.1 NEAR")]
    fn test_06_reject_deposits_below_0_1_near() {
        let mut contract = SwarmSettleContract::new();
        set_context("customer.testnet", 0, 1_000_000_000);
        contract.create_job(
            "Low deposit".to_string(),
            "Desc".to_string(),
            CRITERIA_TEXT.to_string(),
            compute_sha256_hex(CRITERIA_TEXT),
            U64(500_000_000_000_000),
            2,
            None,
            None,
        );
    }

    #[test]
    #[should_panic(expected = "review_window_ns must be at least 1 hour")]
    fn test_07_reject_invalid_review_window() {
        let mut contract = SwarmSettleContract::new();
        set_context("customer.testnet", 5 * ONE_NEAR, 1_000_000_000);
        contract.create_job(
            "Short window".to_string(),
            "Desc".to_string(),
            CRITERIA_TEXT.to_string(),
            compute_sha256_hex(CRITERIA_TEXT),
            U64(500_000_000_000_000),
            2,
            None,
            Some(U64(1000)),
        );
    }

    #[test]
    #[should_panic(expected = "Bidder must register an AgentProfile before submitting a bid")]
    fn test_08_reject_unregistered_bidder() {
        let mut contract = SwarmSettleContract::new();
        let job_id = setup_funded_job(&mut contract);
        set_context("unregistered.testnet", 0, 2_000_000_000);
        contract.submit_bid(job_id, "Research Specialist".to_string(), U128(3 * ONE_NEAR), "Bid".to_string(), None);
    }

    #[test]
    #[should_panic(expected = "Requested payout is below the agent's registered min_rate_yocto")]
    fn test_09_reject_bid_below_registered_minimum_rate() {
        let mut contract = SwarmSettleContract::new();
        let job_id = setup_funded_job(&mut contract);
        set_context("researchpro.testnet", 0, 2_000_000_000);
        contract.submit_bid(job_id, "Research Specialist".to_string(), U128(ONE_NEAR), "Too low".to_string(), None);
    }

    #[test]
    #[should_panic(expected = "Bid role must match one of the job's defined role_slots")]
    fn test_10_reject_bid_with_mismatched_role_slot() {
        let mut contract = SwarmSettleContract::new();
        let job_id = setup_funded_job(&mut contract);
        set_context("researchpro.testnet", 0, 2_000_000_000);
        contract.submit_bid(job_id, "Unlisted Role".to_string(), U128(3 * ONE_NEAR), "Wrong role".to_string(), None);
    }

    #[test]
    fn test_11_timeout_payout_at_review_deadline_and_verifier_hash_binding() {
        let mut contract = SwarmSettleContract::new();
        let job_id = setup_funded_job(&mut contract);
        set_context("researchpro.testnet", 0, 2_000_000_000);
        contract.submit_bid(job_id, "Research Specialist".to_string(), U128(3 * ONE_NEAR), "Bid".to_string(), None);
        set_context("verifyai.testnet", 0, 2_000_000_000);
        contract.submit_bid(job_id, "Quality Auditor".to_string(), U128(2 * ONE_NEAR), "Bid".to_string(), None);
        set_context("customer.testnet", 0, 3_000_000_000);
        contract.select_crew(
            job_id,
            vec![
                CrewSelectionInput { agent: account("researchpro.testnet"), role: "Research Specialist".to_string(), agreed_payout_yocto: U128(3 * ONE_NEAR) },
                CrewSelectionInput { agent: account("verifyai.testnet"), role: "Quality Auditor".to_string(), agreed_payout_yocto: U128(2 * ONE_NEAR) },
            ],
        );
        let submit_ts = 10_000_000_000;
        set_context("researchpro.testnet", 0, submit_ts);
        contract.submit_contribution(job_id, "https://example.org/a1".to_string(), ARTIFACT_HASH_1.to_string(), None);

        set_context("verifyai.testnet", 0, submit_ts + 100);
        let scored = contract.submit_verifier_score(
            job_id,
            account("researchpro.testnet"),
            compute_sha256_hex(CRITERIA_TEXT),
            ARTIFACT_HASH_1.to_string(),
            95,
            "Criteria 1 & 2 verified.".to_string(),
            REPORT_HASH_1.to_string(),
        );
        assert_eq!(scored.verifier_score, Some(95));
        assert_eq!(scored.verifier_audited_artifact_sha256, ARTIFACT_HASH_1);

        // At exact review_deadline_ns, agent timeout claim succeeds
        set_context("researchpro.testnet", 0, submit_ts + DEFAULT_REVIEW_WINDOW_NS);
        contract.claim_timeout_payout(job_id, None);
        set_context("swarmsettle.testnet", 0, submit_ts + DEFAULT_REVIEW_WINDOW_NS + 1);
        contract.on_payout_complete(job_id, account("researchpro.testnet"), U128(3 * ONE_NEAR), true, Ok(()));
        let job = contract.get_job(job_id).unwrap();
        assert_eq!(job.transferred_yocto.0, 3 * ONE_NEAR);
    }

    #[test]
    fn test_12_failed_payout_queues_claimable_pool_and_post_deadline_marks_expired() {
        let mut contract = SwarmSettleContract::new();
        let job_id = setup_funded_job(&mut contract);
        set_context("researchpro.testnet", 0, 2_000_000_000);
        contract.submit_bid(job_id, "Research Specialist".to_string(), U128(3 * ONE_NEAR), "Bid".to_string(), None);
        set_context("marketmind.testnet", 0, 2_000_000_000);
        contract.submit_bid(job_id, "Business Analyst".to_string(), U128(3 * ONE_NEAR), "Bid".to_string(), None);
        set_context("customer.testnet", 0, 3_000_000_000);
        contract.select_crew(
            job_id,
            vec![
                CrewSelectionInput { agent: account("researchpro.testnet"), role: "Research Specialist".to_string(), agreed_payout_yocto: U128(3 * ONE_NEAR) },
                CrewSelectionInput { agent: account("marketmind.testnet"), role: "Business Analyst".to_string(), agreed_payout_yocto: U128(3 * ONE_NEAR) },
            ],
        );
        set_context("researchpro.testnet", 0, 4_000_000_000);
        contract.submit_contribution(job_id, "https://example.org/a1".to_string(), ARTIFACT_HASH_1.to_string(), None);
        set_context("customer.testnet", 0, 5_000_000_000);
        contract.approve_contribution(job_id, account("researchpro.testnet"), Some(5));
        // Simulate failed async transfer -> queued in claimable_pool_yocto, NOT transferred_yocto
        set_context("swarmsettle.testnet", 0, 5_000_000_001);
        let ok = contract.on_payout_complete(
            job_id,
            account("researchpro.testnet"),
            U128(3 * ONE_NEAR),
            false,
            Err(PromiseError::Failed),
        );
        assert!(!ok);
        let job_mid = contract.get_job(job_id).unwrap();
        assert_eq!(job_mid.transferred_yocto.0, 0);
        assert_eq!(job_mid.claimable_pool_yocto.0, 3 * ONE_NEAR);

        // Past job deadline, marketmind (NotSubmitted) transitions to Expired on claim_remaining_refund
        set_context("customer.testnet", 0, 600_000_000_000_000);
        contract.claim_remaining_refund(job_id);
        set_context("swarmsettle.testnet", 0, 600_000_000_000_001);
        contract.on_refund_complete(job_id, account("customer.testnet"), U128(7 * ONE_NEAR), false, Ok(()));
        let job_final = contract.get_job(job_id).unwrap();
        assert_eq!(job_final.status, JobStatus::Completed);
        assert_eq!(job_final.refunded_yocto.0, 7 * ONE_NEAR);
    }
}
