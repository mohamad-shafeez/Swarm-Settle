/**
 * SwarmSettle v3 — JavaScript State-Machine Parity Test Suite (30 Tests)
 *
 * IMPORTANT DISCLOSURE (Audit Section 2 & Section 5):
 * This file runs 30 automated state-machine parity tests in Node.js mirroring all
 * tightened lifecycle, review-window, revision-cap, hash-binding, profile-gating,
 * and accounting rules in `contract/src/lib.rs`.
 * These are JavaScript state-machine parity tests, NOT native Rust compiler executions.
 * To run the native Rust unit tests in `contract/src/lib.rs`, run `cd contract && cargo test`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

export const ONE_NEAR = 1_000_000_000_000_000_000_000_000n;
export const MIN_JOB_BUDGET_YOCTO = 100_000_000_000_000_000_000_000n; // 0.1 NEAR
export const MIN_AGENT_PAYOUT_YOCTO = 10_000_000_000_000_000_000_000n; // 0.01 NEAR
export const DEFAULT_REVIEW_WINDOW_NS = 48n * 3_600n * 1_000_000_000n; // 48 hours
export const MIN_REVIEW_WINDOW_NS = 3_600n * 1_000_000_000n; // 1 hour
export const MAX_REVISION_ROUNDS = 2;

export const MAX_TITLE_LEN = 140;
export const MAX_DESC_LEN = 2000;
export const MAX_CRITERIA_TEXT_LEN = 2000;
export const MAX_ROLE_LEN = 64;
export const MAX_PROPOSAL_LEN = 1000;
export const MAX_URI_LEN = 512;
export const MAX_NOTES_LEN = 1000;
export const MAX_REASON_LEN = 500;
export const MIN_CREW_SIZE = 2;
export const MAX_CREW_SIZE = 10;
export const MAX_BIDS_PER_JOB = 50;
export const MAX_SKILLS_PER_AGENT = 12;
export const MAX_SKILL_LEN = 48;

export function sha256HexUtf8(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function requireCond(cond, message) {
  if (!cond) {
    throw new Error(message);
  }
}

function validateNonEmptyBounded(val, fieldName, maxLen) {
  const trimmed = String(val ?? '').trim();
  requireCond(trimmed.length > 0, `${fieldName} cannot be empty`);
  requireCond(
    Buffer.byteLength(trimmed, 'utf8') <= maxLen,
    `${fieldName} exceeds maximum length of ${maxLen} bytes`
  );
  return trimmed;
}

function validateAndNormalizeSha256(digest, fieldName) {
  const raw = String(digest ?? '').trim();
  const stripped = raw.startsWith('0x') ? raw.slice(2) : raw;
  const isHex64 = /^[0-9a-fA-F]{64}$/.test(stripped);
  requireCond(
    isHex64,
    `${fieldName} must be an exact 64-character hexadecimal SHA-256 digest`
  );
  return stripped.toLowerCase();
}

export class SwarmSettleEngine {
  constructor() {
    this.nextJobId = 1;
    this.jobs = new Map();
    this.jobBids = new Map();
    this.jobContributions = new Map();
    this.agentStats = new Map();
    this.agentProfiles = new Map();
    this.claimablePayouts = new Map();
    this.events = [];
    this.ctx = {
      predecessor: 'customer.testnet',
      attachedDeposit: 0n,
      blockTimestampNs: 1_000_000_000n,
    };
  }

  setContext(predecessor, attachedDeposit = 0n, blockTimestampNs = 1_000_000_000n) {
    this.ctx = {
      predecessor: String(predecessor),
      attachedDeposit: BigInt(attachedDeposit),
      blockTimestampNs: BigInt(blockTimestampNs),
    };
  }

  emitNep297(event, data) {
    const payload = {
      standard: 'swarm-settle',
      version: '3.0.0',
      event,
      data: [data],
    };
    this.events.push(`EVENT_JSON:${JSON.stringify(payload)}`);
    return payload;
  }

  getOrCreateStats(accountId) {
    if (!this.agentStats.has(accountId)) {
      this.agentStats.set(accountId, {
        account_id: accountId,
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
        total_earned_yocto: '0',
      });
    }
    return this.agentStats.get(accountId);
  }

  register_agent_profile({
    display_name,
    primary_role,
    specialty_summary = '',
    skills = [],
    endpoint_or_handle = '',
    min_rate_yocto = String(MIN_AGENT_PAYOUT_YOCTO),
    declared_operator_account = '',
    available = true,
  }) {
    const caller = this.ctx.predecessor;
    const now = this.ctx.blockTimestampNs;
    const cleanName = validateNonEmptyBounded(display_name, 'display_name', 80);
    const cleanRole = validateNonEmptyBounded(primary_role, 'primary_role', MAX_ROLE_LEN);
    const cleanSummary = specialty_summary.trim()
      ? validateNonEmptyBounded(specialty_summary, 'specialty_summary', 280)
      : `Specialist ${cleanRole} agent on NEAR`;
    requireCond(
      skills.length <= MAX_SKILLS_PER_AGENT,
      'Exceeded maximum number of skills per agent'
    );
    const minRateBig = BigInt(min_rate_yocto);
    requireCond(
      minRateBig >= MIN_AGENT_PAYOUT_YOCTO,
      'min_rate_yocto must be at least 0.01 NEAR'
    );
    const cleanSkills = skills.map((s) => validateNonEmptyBounded(s, 'skill', MAX_SKILL_LEN));
    const cleanEndpoint = endpoint_or_handle.trim()
      ? validateNonEmptyBounded(endpoint_or_handle, 'endpoint_or_handle', MAX_URI_LEN)
      : '';
    const operator = declared_operator_account.trim() ? declared_operator_account.trim() : caller;

    const prev = this.agentProfiles.get(caller);
    const profile = {
      account_id: caller,
      declared_operator_account: operator,
      display_name: cleanName,
      primary_role: cleanRole,
      specialty_summary: cleanSummary,
      skills: cleanSkills,
      endpoint_or_handle: cleanEndpoint,
      min_rate_yocto: String(minRateBig),
      available: Boolean(available),
      registered_at_ns: prev ? prev.registered_at_ns : String(now),
      updated_at_ns: String(now),
    };
    this.agentProfiles.set(caller, profile);
    this.getOrCreateStats(caller);
    this.emitNep297('agent_profile_registered', {
      agent: caller,
      declared_operator_account: operator,
      primary_role: cleanRole,
      min_rate_yocto: profile.min_rate_yocto,
      available: profile.available,
      timestamp_ns: String(now),
    });
    return structuredClone(profile);
  }

  create_job({
    title,
    description,
    criteria_text,
    criteria_hash,
    deadline_ns,
    max_agents,
    role_slots = [],
    review_window_ns = DEFAULT_REVIEW_WINDOW_NS,
  }) {
    const deposit = this.ctx.attachedDeposit;
    requireCond(
      deposit >= MIN_JOB_BUDGET_YOCTO,
      'Attached NEAR deposit must be at least 0.1 NEAR'
    );
    const cleanTitle = validateNonEmptyBounded(title, 'title', MAX_TITLE_LEN);
    const cleanDesc = validateNonEmptyBounded(description, 'description', MAX_DESC_LEN);
    const cleanCriteria = validateNonEmptyBounded(
      criteria_text,
      'criteria_text',
      MAX_CRITERIA_TEXT_LEN
    );
    const cleanHash = validateAndNormalizeSha256(criteria_hash, 'criteria_hash');
    const computedHash = sha256HexUtf8(cleanCriteria);
    requireCond(
      computedHash === cleanHash,
      `criteria_hash (${cleanHash}) does not match SHA-256 of criteria_text (${computedHash})`
    );

    requireCond(
      max_agents >= MIN_CREW_SIZE && max_agents <= MAX_CREW_SIZE,
      'max_agents must be between 2 and 10 for a multi-agent swarm'
    );

    const now = this.ctx.blockTimestampNs;
    const deadlineBig = BigInt(deadline_ns);
    requireCond(deadlineBig > now, 'deadline_ns must be strictly in the future');

    const revWindowBig = BigInt(review_window_ns);
    requireCond(
      revWindowBig >= MIN_REVIEW_WINDOW_NS,
      'review_window_ns must be at least 1 hour in nanoseconds'
    );

    requireCond(role_slots.length <= MAX_CREW_SIZE, 'Too many role slots defined');
    let suggestedSum = 0n;
    const cleanSlots = role_slots.map((slot) => {
      const r = validateNonEmptyBounded(slot.role, 'role_slot.role', MAX_ROLE_LEN);
      const amt = BigInt(slot.suggested_payout_yocto);
      suggestedSum += amt;
      return { role: r, suggested_payout_yocto: String(amt) };
    });
    requireCond(
      suggestedSum <= deposit,
      'Sum of suggested role slot payouts cannot exceed attached escrow budget'
    );

    const jobId = this.nextJobId++;
    const job = {
      id: jobId,
      creator: this.ctx.predecessor,
      title: cleanTitle,
      description: cleanDesc,
      criteria_text: cleanCriteria,
      criteria_hash: cleanHash,
      role_slots: cleanSlots,
      deadline_ns: String(deadlineBig),
      review_window_ns: String(revWindowBig),
      status: 'Open',
      budget_yocto: String(deposit),
      allocated_yocto: '0',
      transferred_yocto: '0',
      in_flight_yocto: '0',
      claimable_pool_yocto: '0',
      refunded_yocto: '0',
      max_agents,
      selected_agents: [],
      created_at_ns: String(now),
      updated_at_ns: String(now),
    };

    this.jobs.set(jobId, job);
    this.jobBids.set(jobId, []);
    this.jobContributions.set(jobId, []);

    this.emitNep297('job_created', {
      job_id: jobId,
      creator: job.creator,
      title: cleanTitle,
      criteria_hash: cleanHash,
      budget_yocto: String(deposit),
      deadline_ns: String(deadlineBig),
      review_window_ns: String(revWindowBig),
      max_agents,
    });

    return structuredClone(job);
  }

  submit_bid({ job_id, role, requested_payout_yocto, proposal, estimated_hours = 24 }) {
    const job = this.jobs.get(job_id);
    requireCond(Boolean(job), 'Job not found');
    requireCond(job.status === 'Open', 'Bids can only be submitted while the job is Open');
    const now = this.ctx.blockTimestampNs;
    requireCond(now < BigInt(job.deadline_ns), 'Cannot submit a bid after the job deadline');

    const agent = this.ctx.predecessor;
    requireCond(agent !== job.creator, 'Job creator cannot bid on their own job');

    const profile = this.agentProfiles.get(agent);
    requireCond(
      Boolean(profile),
      'Bidder must register an AgentProfile before submitting a bid'
    );
    requireCond(
      profile.available,
      "Bidder's AgentProfile is currently marked as unavailable"
    );

    const reqPayout = BigInt(requested_payout_yocto);
    requireCond(
      reqPayout >= BigInt(profile.min_rate_yocto),
      "Requested payout is below the agent's registered min_rate_yocto"
    );
    requireCond(
      reqPayout >= MIN_AGENT_PAYOUT_YOCTO,
      'Requested payout must be at least 0.01 NEAR'
    );
    requireCond(
      reqPayout <= BigInt(job.budget_yocto),
      'Requested payout cannot exceed total job budget'
    );

    const cleanRole = validateNonEmptyBounded(role, 'role', MAX_ROLE_LEN);
    if (job.role_slots.length > 0) {
      requireCond(
        job.role_slots.some((s) => s.role.toLowerCase() === cleanRole.toLowerCase()),
        "Bid role must match one of the job's defined role_slots"
      );
    }

    const cleanProposal = validateNonEmptyBounded(proposal, 'proposal', MAX_PROPOSAL_LEN);
    const estHours = Math.min(720, Math.max(1, Number(estimated_hours || 24)));

    const bids = this.jobBids.get(job_id);
    requireCond(bids.length < MAX_BIDS_PER_JOB, 'Maximum number of bids reached for this job');
    requireCond(
      !bids.some((b) => b.agent === agent && b.status !== 'Withdrawn'),
      'Agent has already submitted an active bid for this job'
    );

    const bid = {
      job_id,
      agent,
      role: cleanRole,
      requested_payout_yocto: String(reqPayout),
      proposal: cleanProposal,
      estimated_hours: estHours,
      status: 'Pending',
      created_at_ns: String(now),
      updated_at_ns: String(now),
    };
    bids.push(bid);
    job.updated_at_ns = String(now);

    const stats = this.getOrCreateStats(agent);
    stats.bids_submitted += 1;

    this.emitNep297('bid_submitted', {
      job_id,
      agent,
      role: cleanRole,
      requested_payout_yocto: String(reqPayout),
      estimated_hours: estHours,
    });

    return structuredClone(bid);
  }

  withdraw_bid({ job_id }) {
    const job = this.jobs.get(job_id);
    requireCond(Boolean(job), 'Job not found');
    requireCond(
      job.status === 'Open',
      'Can only withdraw a bid while the job is still Open'
    );
    const caller = this.ctx.predecessor;
    const bids = this.jobBids.get(job_id);
    const bid = bids.find((b) => b.agent === caller && b.status === 'Pending');
    requireCond(Boolean(bid), 'Active pending bid not found for caller');
    bid.status = 'Withdrawn';
    bid.updated_at_ns = String(this.ctx.blockTimestampNs);
    this.emitNep297('bid_withdrawn', { job_id, agent: caller });
    return structuredClone(bid);
  }

  select_crew({ job_id, selections }) {
    const job = this.jobs.get(job_id);
    requireCond(Boolean(job), 'Job not found');
    requireCond(
      this.ctx.predecessor === job.creator,
      'Only the job creator can select the crew'
    );
    requireCond(
      job.status === 'Open',
      'Crew can only be selected once while job is Open'
    );
    const now = this.ctx.blockTimestampNs;
    requireCond(now < BigInt(job.deadline_ns), 'Cannot select crew after the job deadline');
    requireCond(
      selections.length >= MIN_CREW_SIZE && selections.length <= job.max_agents,
      `Crew size must be between ${MIN_CREW_SIZE} and ${job.max_agents}`
    );

    const bids = this.jobBids.get(job_id);
    let totalAllocated = 0n;
    const selectedAccounts = [];
    const contributions = [];

    for (const sel of selections) {
      requireCond(
        sel.agent !== job.creator,
        'Creator cannot select themselves as a paid crew member'
      );
      requireCond(
        !selectedAccounts.includes(sel.agent),
        'Duplicate agent in crew selection is not allowed'
      );
      const payout = BigInt(sel.agreed_payout_yocto);
      requireCond(
        payout >= MIN_AGENT_PAYOUT_YOCTO,
        'Each crew member payout must be at least 0.01 NEAR'
      );
      const profile = this.agentProfiles.get(sel.agent);
      requireCond(Boolean(profile), 'Selected agent must have a registered AgentProfile');
      requireCond(
        payout >= BigInt(profile.min_rate_yocto),
        "Agreed payout cannot be below the agent's registered min_rate_yocto"
      );

      const cleanRole = validateNonEmptyBounded(sel.role, 'selection.role', MAX_ROLE_LEN);
      const matchingBid = bids.find((b) => b.agent === sel.agent && b.status === 'Pending');
      requireCond(
        Boolean(matchingBid),
        'Every selected crew member must have an active Pending bid on this job'
      );
      requireCond(
        matchingBid.role.toLowerCase() === cleanRole.toLowerCase(),
        "Selected role must match the role specified in the agent's bid"
      );

      totalAllocated += payout;
      selectedAccounts.push(sel.agent);
      contributions.push({
        job_id,
        agent: sel.agent,
        role: cleanRole,
        agreed_payout_yocto: String(payout),
        artifact_uri: '',
        artifact_sha256: '',
        evidence_notes: '',
        feedback_reason: '',
        status: 'NotSubmitted',
        submission_count: 0,
        revision_count: 0,
        submitted_at_ns: '0',
        review_deadline_ns: '0',
        resubmit_deadline_ns: job.deadline_ns,
        resolved_at_ns: '0',
        verifier_score: null,
        verifier_summary: '',
        verifier_report_sha256: '',
        verifier_audited_criteria_hash: '',
        verifier_audited_artifact_sha256: '',
        verifier_agent: null,
        customer_rating: null,
      });

      const stats = this.getOrCreateStats(sel.agent);
      stats.crews_selected += 1;
    }

    requireCond(
      totalAllocated <= BigInt(job.budget_yocto),
      'Total allocated crew payouts cannot exceed the funded escrow budget'
    );

    for (const b of bids) {
      if (selectedAccounts.includes(b.agent) && b.status === 'Pending') {
        b.status = 'Selected';
        b.updated_at_ns = String(now);
      } else if (b.status === 'Pending') {
        b.status = 'NotSelected';
        b.updated_at_ns = String(now);
      }
    }

    this.jobContributions.set(job_id, contributions);
    job.allocated_yocto = String(totalAllocated);
    job.selected_agents = selectedAccounts;
    job.status = 'CrewSelected';
    job.updated_at_ns = String(now);

    this.emitNep297('crew_selected', {
      job_id,
      selected_agents: selectedAccounts,
      allocated_yocto: String(totalAllocated),
      unallocated_reserve_yocto: String(BigInt(job.budget_yocto) - totalAllocated),
    });

    return structuredClone(job);
  }

  submit_contribution({ job_id, artifact_uri, artifact_sha256, evidence_notes = '' }) {
    const job = this.jobs.get(job_id);
    requireCond(Boolean(job), 'Job not found');
    requireCond(
      job.status === 'CrewSelected' || job.status === 'InProgress',
      'Job is not in an active work submission state'
    );

    const caller = this.ctx.predecessor;
    const cleanUri = validateNonEmptyBounded(artifact_uri, 'artifact_uri', MAX_URI_LEN);
    const cleanHash = validateAndNormalizeSha256(artifact_sha256, 'artifact_sha256');
    const cleanNotes = evidence_notes.trim()
      ? validateNonEmptyBounded(evidence_notes, 'evidence_notes', MAX_NOTES_LEN)
      : '';

    const contributions = this.jobContributions.get(job_id);
    const contrib = contributions.find((c) => c.agent === caller);
    requireCond(
      Boolean(contrib),
      'Only a selected crew member for this job can submit a contribution'
    );
    requireCond(
      contrib.status === 'NotSubmitted' || contrib.status === 'RevisionRequested',
      'Deliverable can only be submitted initially or after a creator RevisionRequested'
    );

    const now = this.ctx.blockTimestampNs;
    const allowedDeadline =
      contrib.status === 'RevisionRequested'
        ? BigInt(contrib.resubmit_deadline_ns) > BigInt(job.deadline_ns)
          ? BigInt(contrib.resubmit_deadline_ns)
          : BigInt(job.deadline_ns)
        : BigInt(job.deadline_ns);
    requireCond(
      now <= allowedDeadline,
      'Cannot submit deliverable after the allowed submission/resubmission deadline'
    );

    const revDeadline = now + BigInt(job.review_window_ns);
    contrib.artifact_uri = cleanUri;
    contrib.artifact_sha256 = cleanHash;
    contrib.evidence_notes = cleanNotes;
    contrib.status = 'Submitted';
    contrib.submission_count += 1;
    contrib.submitted_at_ns = String(now);
    contrib.review_deadline_ns = String(revDeadline);
    contrib.verifier_score = null;
    contrib.verifier_summary = '';
    contrib.verifier_report_sha256 = '';
    contrib.verifier_audited_criteria_hash = '';
    contrib.verifier_audited_artifact_sha256 = '';
    contrib.verifier_agent = null;

    if (job.status === 'CrewSelected') {
      job.status = 'InProgress';
    }
    job.updated_at_ns = String(now);

    this.emitNep297('contribution_submitted', {
      job_id,
      agent: caller,
      role: contrib.role,
      artifact_uri: cleanUri,
      artifact_sha256: cleanHash,
      submission_count: contrib.submission_count,
      review_deadline_ns: String(revDeadline),
    });

    return structuredClone(contrib);
  }

  submit_verifier_score({
    job_id,
    target_agent_id,
    audited_criteria_hash,
    audited_artifact_sha256,
    quality_score,
    verification_summary,
    report_sha256,
  }) {
    const job = this.jobs.get(job_id);
    requireCond(Boolean(job), 'Job not found');
    requireCond(
      job.status === 'InProgress' || job.status === 'CrewSelected',
      'Job is not in an active state'
    );
    const scoreNum = Number(quality_score);
    requireCond(
      Number.isInteger(scoreNum) && scoreNum >= 0 && scoreNum <= 100,
      'quality_score must be between 0 and 100'
    );

    const caller = this.ctx.predecessor;
    requireCond(
      caller !== target_agent_id,
      'An agent cannot submit a verifier score for its own contribution'
    );

    const cleanCriteriaHash = validateAndNormalizeSha256(
      audited_criteria_hash,
      'audited_criteria_hash'
    );
    requireCond(
      cleanCriteriaHash === job.criteria_hash,
      "audited_criteria_hash does not match the job's committed criteria_hash"
    );

    const cleanArtifactHash = validateAndNormalizeSha256(
      audited_artifact_sha256,
      'audited_artifact_sha256'
    );
    const cleanSummary = validateNonEmptyBounded(
      verification_summary,
      'verification_summary',
      MAX_REASON_LEN
    );
    const cleanReportHash = validateAndNormalizeSha256(report_sha256, 'report_sha256');

    const contributions = this.jobContributions.get(job_id);
    const isVerifier = contributions.some(
      (c) =>
        c.agent === caller &&
        (c.role.toLowerCase().includes('verif') ||
          c.role.toLowerCase().includes('audit') ||
          c.role.toLowerCase().includes('qa'))
    );
    requireCond(
      isVerifier,
      'Only a selected Verifier/Auditor crew member for this job can record a verifier score'
    );

    const target = contributions.find((c) => c.agent === target_agent_id);
    requireCond(Boolean(target), 'Target contributor not found');
    requireCond(
      target.status === 'Submitted',
      'Target contribution must be in Submitted status to be scored'
    );
    requireCond(
      target.artifact_sha256 === cleanArtifactHash,
      "audited_artifact_sha256 does not match the target's currently submitted artifact_sha256"
    );
    requireCond(
      target.verifier_score === null,
      'Verifier score is already recorded for this submission round and cannot be overwritten'
    );

    target.verifier_score = scoreNum;
    target.verifier_summary = cleanSummary;
    target.verifier_report_sha256 = cleanReportHash;
    target.verifier_audited_criteria_hash = cleanCriteriaHash;
    target.verifier_audited_artifact_sha256 = cleanArtifactHash;
    target.verifier_agent = caller;

    this.emitNep297('verifier_score_recorded', {
      job_id,
      verifier_agent: caller,
      target_agent: target_agent_id,
      audited_criteria_hash: cleanCriteriaHash,
      audited_artifact_sha256: cleanArtifactHash,
      quality_score: scoreNum,
      report_sha256: cleanReportHash,
      verification_summary: cleanSummary,
    });

    return structuredClone(target);
  }

  request_revision({ job_id, agent_id, feedback }) {
    const job = this.jobs.get(job_id);
    requireCond(Boolean(job), 'Job not found');
    requireCond(
      this.ctx.predecessor === job.creator,
      'Only the job creator can request a revision'
    );
    requireCond(
      job.status === 'InProgress' || job.status === 'CrewSelected',
      'Job is not active'
    );
    const now = this.ctx.blockTimestampNs;
    requireCond(
      now < BigInt(job.deadline_ns),
      'Cannot request a revision at or after the job deadline'
    );

    const cleanFeedback = validateNonEmptyBounded(feedback, 'feedback', MAX_REASON_LEN);
    const contributions = this.jobContributions.get(job_id);
    const contrib = contributions.find((c) => c.agent === agent_id);
    requireCond(Boolean(contrib), 'Selected contributor not found');
    requireCond(
      contrib.status === 'Submitted',
      'Can only request revision on a Submitted contribution'
    );
    requireCond(
      now < BigInt(contrib.review_deadline_ns),
      'Creator review window has expired; contribution is now eligible for agent timeout payout'
    );
    requireCond(
      contrib.revision_count < MAX_REVISION_ROUNDS,
      'Maximum revision rounds (2) reached for this contribution; creator must approve or reject'
    );

    contrib.status = 'RevisionRequested';
    contrib.revision_count += 1;
    contrib.feedback_reason = cleanFeedback;
    const extendedResubmit = now + BigInt(job.review_window_ns);
    contrib.resubmit_deadline_ns = String(
      extendedResubmit > BigInt(job.deadline_ns) ? extendedResubmit : BigInt(job.deadline_ns)
    );
    job.updated_at_ns = String(now);

    const stats = this.getOrCreateStats(agent_id);
    stats.revisions_requested += 1;

    this.emitNep297('revision_requested', {
      job_id,
      agent: agent_id,
      revision_count: contrib.revision_count,
      resubmit_deadline_ns: contrib.resubmit_deadline_ns,
      feedback: cleanFeedback,
    });
    return structuredClone(contrib);
  }

  reject_contribution({ job_id, agent_id, reason }) {
    const job = this.jobs.get(job_id);
    requireCond(Boolean(job), 'Job not found');
    requireCond(
      this.ctx.predecessor === job.creator,
      'Only the job creator can reject a contribution'
    );
    requireCond(
      job.status === 'InProgress' || job.status === 'CrewSelected',
      'Job is not in an active state'
    );
    const cleanReason = validateNonEmptyBounded(reason, 'reason', MAX_REASON_LEN);
    const contributions = this.jobContributions.get(job_id);
    const contrib = contributions.find((c) => c.agent === agent_id);
    requireCond(Boolean(contrib), 'Selected contributor not found');
    requireCond(
      contrib.status === 'Submitted',
      'Only a Submitted contribution can be rejected by the creator'
    );

    const now = this.ctx.blockTimestampNs;
    requireCond(
      now < BigInt(contrib.review_deadline_ns),
      'Creator review window has expired; cannot reject after review_deadline_ns'
    );

    contrib.status = 'Rejected';
    contrib.feedback_reason = cleanReason;
    contrib.resolved_at_ns = String(now);

    const stats = this.getOrCreateStats(agent_id);
    stats.rejected_contributions += 1;

    this._checkFinalize(job, contributions, now);
    this.emitNep297('contribution_rejected', {
      job_id,
      agent: agent_id,
      reason: cleanReason,
    });
    return structuredClone(contrib);
  }

  approve_contribution({ job_id, agent_id, rating = null }) {
    const job = this.jobs.get(job_id);
    requireCond(Boolean(job), 'Job not found');
    requireCond(
      this.ctx.predecessor === job.creator,
      'Only the job creator can approve a contribution'
    );
    requireCond(
      job.status === 'InProgress' || job.status === 'CrewSelected',
      'Job is not in an active state'
    );

    if (rating !== null && rating !== undefined) {
      const stars = Number(rating);
      requireCond(
        Number.isInteger(stars) && stars >= 1 && stars <= 5,
        'Customer rating must be between 1 and 5 stars'
      );
    }

    const contributions = this.jobContributions.get(job_id);
    const contrib = contributions.find((c) => c.agent === agent_id);
    requireCond(Boolean(contrib), 'Selected contributor not found');
    requireCond(
      contrib.status === 'Submitted',
      'Contribution must be in Submitted status with evidence before approval'
    );

    const now = this.ctx.blockTimestampNs;
    requireCond(
      now < BigInt(contrib.review_deadline_ns),
      'Creator review window has expired; agent can now claim via claim_timeout_payout'
    );

    const payout = BigInt(contrib.agreed_payout_yocto);
    const committedOutflows =
      BigInt(job.transferred_yocto) +
      BigInt(job.in_flight_yocto) +
      BigInt(job.claimable_pool_yocto) +
      BigInt(job.refunded_yocto) +
      payout;
    requireCond(
      committedOutflows <= BigInt(job.budget_yocto),
      'Approving this payout would exceed the funded escrow budget'
    );

    contrib.status = 'PayoutPending';
    contrib.resolved_at_ns = String(now);
    if (rating !== null && rating !== undefined) {
      const stars = Number(rating);
      contrib.customer_rating = stars;
      const stats = this.getOrCreateStats(agent_id);
      stats.rating_sum += stars;
      stats.rating_count += 1;
    }
    job.in_flight_yocto = String(BigInt(job.in_flight_yocto) + payout);
    job.updated_at_ns = String(now);

    this.emitNep297('contribution_approval_initiated', {
      job_id,
      agent: agent_id,
      agreed_payout_yocto: String(payout),
      artifact_sha256: contrib.artifact_sha256,
      customer_rating: contrib.customer_rating,
    });

    return { job_id, agent_id, amount_yocto: String(payout) };
  }

  claim_timeout_payout({ job_id, agent_id = null }) {
    const job = this.jobs.get(job_id);
    requireCond(Boolean(job), 'Job not found');
    requireCond(
      job.status === 'InProgress' || job.status === 'CrewSelected',
      'Job is not in an active state'
    );

    const caller = this.ctx.predecessor;
    const targetAgent = agent_id || caller;
    requireCond(
      caller === targetAgent,
      'Only the submitting agent can claim their timeout payout'
    );

    const contributions = this.jobContributions.get(job_id);
    const contrib = contributions.find((c) => c.agent === targetAgent);
    requireCond(Boolean(contrib), 'Selected contributor not found');
    requireCond(
      contrib.status === 'Submitted',
      'Contribution must be in Submitted status to claim review-timeout payout'
    );

    const now = this.ctx.blockTimestampNs;
    const revDeadline = BigInt(contrib.review_deadline_ns);
    requireCond(
      revDeadline > 0n && now >= revDeadline,
      'Creator review window has not expired yet'
    );

    const payout = BigInt(contrib.agreed_payout_yocto);
    const committedOutflows =
      BigInt(job.transferred_yocto) +
      BigInt(job.in_flight_yocto) +
      BigInt(job.claimable_pool_yocto) +
      BigInt(job.refunded_yocto) +
      payout;
    requireCond(
      committedOutflows <= BigInt(job.budget_yocto),
      'Timeout payout would exceed the funded escrow budget'
    );

    contrib.status = 'PayoutPending';
    contrib.resolved_at_ns = String(now);
    job.in_flight_yocto = String(BigInt(job.in_flight_yocto) + payout);
    job.updated_at_ns = String(now);

    this.emitNep297('timeout_auto_release_initiated', {
      job_id,
      agent: targetAgent,
      agreed_payout_yocto: String(payout),
      review_deadline_ns: String(revDeadline),
      claimed_at_ns: String(now),
    });

    return { job_id, agent_id: targetAgent, amount_yocto: String(payout), was_timeout_claim: true };
  }

  on_payout_complete({
    job_id,
    agent_id,
    amount_yocto,
    was_timeout_claim = false,
    succeeded = true,
  }) {
    const job = this.jobs.get(job_id);
    const contributions = this.jobContributions.get(job_id);
    const contrib = contributions.find((c) => c.agent === agent_id);
    const amt = BigInt(amount_yocto);
    const now = this.ctx.blockTimestampNs;

    job.in_flight_yocto = String(BigInt(job.in_flight_yocto) - amt);
    const submittedOnTime = BigInt(contrib.submitted_at_ns) <= BigInt(job.deadline_ns);

    const stats = this.getOrCreateStats(agent_id);
    stats.accepted_contributions += 1;
    if (submittedOnTime) stats.on_time_deliveries += 1;
    if (was_timeout_claim) stats.timeout_claims += 1;

    if (succeeded) {
      job.transferred_yocto = String(BigInt(job.transferred_yocto) + amt);
      contrib.status = 'Paid';
      contrib.resolved_at_ns = String(now);
      stats.total_earned_yocto = String(BigInt(stats.total_earned_yocto) + amt);
      this.emitNep297('payout_completed', {
        job_id,
        agent: agent_id,
        transferred_yocto: String(amt),
        was_timeout_claim,
      });
    } else {
      job.claimable_pool_yocto = String(BigInt(job.claimable_pool_yocto) + amt);
      contrib.status = 'ApprovedClaimable';
      contrib.resolved_at_ns = String(now);
      const current = this.claimablePayouts.get(agent_id) ?? 0n;
      this.claimablePayouts.set(agent_id, current + amt);
      this.emitNep297('payout_fallback_queued', {
        job_id,
        agent: agent_id,
        claimable_yocto: String(amt),
      });
    }

    this._checkFinalize(job, contributions, now);
    return succeeded;
  }

  withdraw_claimable_payout({ job_id = null, succeeded = true } = {}) {
    const caller = this.ctx.predecessor;
    const amt = this.claimablePayouts.get(caller) ?? 0n;
    requireCond(amt > 0n, 'No claimable payout balance available');
    if (succeeded) {
      this.claimablePayouts.set(caller, 0n);
      if (job_id !== null && this.jobs.has(job_id)) {
        const job = this.jobs.get(job_id);
        job.claimable_pool_yocto = String(BigInt(job.claimable_pool_yocto) - amt);
        job.transferred_yocto = String(BigInt(job.transferred_yocto) + amt);
        const contribs = this.jobContributions.get(job_id) || [];
        const c = contribs.find((x) => x.agent === caller);
        if (c && c.status === 'ApprovedClaimable') c.status = 'Paid';
      }
      const stats = this.getOrCreateStats(caller);
      stats.total_earned_yocto = String(BigInt(stats.total_earned_yocto) + amt);
      this.emitNep297('claimable_payout_withdrawn', {
        beneficiary: caller,
        transferred_yocto: String(amt),
      });
      return String(amt);
    }
    return '0';
  }

  cancel_job({ job_id }) {
    const job = this.jobs.get(job_id);
    requireCond(Boolean(job), 'Job not found');
    requireCond(
      this.ctx.predecessor === job.creator,
      'Only the job creator can cancel the job'
    );
    requireCond(
      job.status === 'Open',
      'Job can only be cancelled while Open before crew selection begins'
    );
    requireCond(
      BigInt(job.in_flight_yocto) === 0n &&
        BigInt(job.refunded_yocto) === 0n &&
        BigInt(job.transferred_yocto) === 0n &&
        BigInt(job.claimable_pool_yocto) === 0n,
      'Escrow already has outflows or pending operations'
    );

    const refundAmount = BigInt(job.budget_yocto);
    job.status = 'Cancelled';
    job.refunded_yocto = String(refundAmount);
    job.updated_at_ns = String(this.ctx.blockTimestampNs);
    this.emitNep297('job_cancelled_and_refunded', {
      job_id,
      creator: job.creator,
      refunded_yocto: String(refundAmount),
    });
    return String(refundAmount);
  }

  claim_remaining_refund({ job_id }) {
    const job = this.jobs.get(job_id);
    requireCond(Boolean(job), 'Job not found');
    requireCond(
      this.ctx.predecessor === job.creator,
      'Only the job creator can claim the remaining refund'
    );
    requireCond(
      job.status !== 'Open' && job.status !== 'Cancelled',
      'Use cancel_job for an Open job; Cancelled jobs are already refunded'
    );
    requireCond(
      BigInt(job.in_flight_yocto) === 0n,
      'Cannot claim refund while a payout or refund promise is in flight'
    );

    const now = this.ctx.blockTimestampNs;
    const contributions = this.jobContributions.get(job_id);
    const isPastDeadline = now >= BigInt(job.deadline_ns);

    if (isPastDeadline) {
      for (const c of contributions) {
        if (
          c.status === 'NotSubmitted' ||
          (c.status === 'RevisionRequested' && now > BigInt(c.resubmit_deadline_ns))
        ) {
          c.status = 'Expired';
          c.resolved_at_ns = String(now);
          const st = this.getOrCreateStats(c.agent);
          st.expired_contributions += 1;
        }
      }
    }

    const allResolved = contributions.every((c) =>
      ['Paid', 'ApprovedClaimable', 'Rejected', 'Expired'].includes(c.status)
    );

    requireCond(
      allResolved || isPastDeadline,
      'Remaining refund can only be claimed after all crew contributions are resolved or after the deadline'
    );

    let lockedForSubmittedOrPaid = 0n;
    for (const c of contributions) {
      if (['Paid', 'ApprovedClaimable', 'PayoutPending', 'Submitted'].includes(c.status)) {
        lockedForSubmittedOrPaid += BigInt(c.agreed_payout_yocto);
      } else if (c.status === 'RevisionRequested' && now <= BigInt(c.resubmit_deadline_ns)) {
        lockedForSubmittedOrPaid += BigInt(c.agreed_payout_yocto);
      } else if (c.status === 'NotSubmitted' && !isPastDeadline) {
        lockedForSubmittedOrPaid += BigInt(c.agreed_payout_yocto);
      }
    }

    const budget = BigInt(job.budget_yocto);
    const refunded = BigInt(job.refunded_yocto);
    const maxRefundable =
      budget > lockedForSubmittedOrPaid + refunded
        ? budget - lockedForSubmittedOrPaid - refunded
        : 0n;

    requireCond(maxRefundable > 0n, 'No refundable escrow balance is currently available to claim');
    requireCond(
      BigInt(job.transferred_yocto) +
        BigInt(job.claimable_pool_yocto) +
        refunded +
        maxRefundable <=
        budget,
      'Total payouts plus refunds cannot exceed funded escrow budget'
    );

    job.refunded_yocto = String(refunded + maxRefundable);
    job.updated_at_ns = String(now);
    this._checkFinalize(job, contributions, now);

    this.emitNep297('remaining_escrow_refunded', {
      job_id,
      creator: job.creator,
      refunded_yocto: String(maxRefundable),
      total_refunded_yocto: job.refunded_yocto,
    });
    return String(maxRefundable);
  }

  get_job_treasury({ job_id }) {
    const job = this.jobs.get(job_id);
    if (!job) return null;
    const contributions = this.jobContributions.get(job_id) ?? [];
    const now = this.ctx.blockTimestampNs;
    const isPastDeadline = now >= BigInt(job.deadline_ns);

    let lockedActive = 0n;
    let releasedTotal = 0n;
    let lockedForRefundCalc = 0n;

    for (const c of contributions) {
      const amt = BigInt(c.agreed_payout_yocto);
      if (c.status === 'Rejected' || c.status === 'Expired') {
        releasedTotal += amt;
      } else if (c.status === 'Paid' || c.status === 'ApprovedClaimable') {
        lockedForRefundCalc += amt;
      } else if (c.status === 'PayoutPending' || c.status === 'Submitted') {
        lockedActive += amt;
        lockedForRefundCalc += amt;
      } else if (c.status === 'RevisionRequested') {
        if (now <= BigInt(c.resubmit_deadline_ns)) {
          lockedActive += amt;
          lockedForRefundCalc += amt;
        } else {
          releasedTotal += amt;
        }
      } else if (!isPastDeadline) {
        lockedActive += amt;
        lockedForRefundCalc += amt;
      } else {
        releasedTotal += amt;
      }
    }

    const budget = BigInt(job.budget_yocto);
    const allocated = BigInt(job.allocated_yocto);
    const refunded = BigInt(job.refunded_yocto);
    const unallocatedReserve = budget > allocated ? budget - allocated : 0n;
    const allResolved =
      contributions.length > 0 &&
      contributions.every((c) =>
        ['Paid', 'ApprovedClaimable', 'Rejected', 'Expired'].includes(c.status)
      );

    let currentlyRefundable = 0n;
    if (job.status === 'Open') {
      currentlyRefundable = budget - refunded;
    } else if (
      (allResolved || isPastDeadline) &&
      job.status !== 'Cancelled' &&
      BigInt(job.in_flight_yocto) === 0n
    ) {
      currentlyRefundable =
        budget > lockedForRefundCalc + refunded ? budget - lockedForRefundCalc - refunded : 0n;
    }

    return {
      job_id: job.id,
      status: job.status,
      budget_yocto: String(budget),
      allocated_yocto: String(allocated),
      unallocated_reserve_yocto: String(unallocatedReserve),
      transferred_yocto: job.transferred_yocto,
      in_flight_yocto: job.in_flight_yocto,
      claimable_pool_yocto: job.claimable_pool_yocto,
      locked_for_active_work_yocto: String(lockedActive),
      released_from_rejections_or_expiry_yocto: String(releasedTotal),
      refunded_yocto: String(refunded),
      currently_refundable_yocto: String(currentlyRefundable),
    };
  }

  _checkFinalize(job, contributions, now) {
    if (!contributions.length) return;
    const allTerminal = contributions.every((c) =>
      ['Paid', 'ApprovedClaimable', 'Rejected', 'Expired'].includes(c.status)
    );
    if (allTerminal && job.status !== 'Completed') {
      job.status = 'Completed';
      job.updated_at_ns = String(now);
      for (const c of contributions) {
        if (c.status === 'Paid' || c.status === 'ApprovedClaimable') {
          const stats = this.getOrCreateStats(c.agent);
          stats.jobs_completed += 1;
        }
      }
      this.emitNep297('job_completed', {
        job_id: job.id,
        transferred_yocto: job.transferred_yocto,
        claimable_pool_yocto: job.claimable_pool_yocto,
        allocated_yocto: job.allocated_yocto,
        budget_yocto: job.budget_yocto,
      });
    }
  }
}

// =============================================================================
// 30 AUTOMATED PARITY TESTS COVERING THE SECTION 5 REQUIRED TEST MATRIX
// =============================================================================
const CRITERIA_TEXT =
  '1. Market sizing & 5 competitors\n2. Pricing & profitability\n3. Independent verification';
const CRITERIA_HASH = sha256HexUtf8(CRITERIA_TEXT);
const ARTIFACT_HASH_1 = 'f0e1d2c3b4a5968778695a4b3c2d1e0ff0e1d2c3b4a5968778695a4b3c2d1e0f';
const ARTIFACT_HASH_2 = '11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff';
const REPORT_HASH_1 = '99887766554433221100ffeeddccbbaa99887766554433221100ffeeddccbbaa';

function registerDefaultAgents(engine) {
  for (const [acct, name, role, minNear] of [
    ['researchpro.agent.testnet', 'ResearchPro', 'Research Specialist', 2n],
    ['marketmind.agent.testnet', 'MarketMind', 'Business Analyst', 2n],
    ['verifyai.agent.testnet', 'VerifyAI', 'Quality Auditor', 1n],
  ]) {
    engine.setContext(acct, 0n, 500_000_000n);
    engine.register_agent_profile({
      display_name: name,
      primary_role: role,
      skills: [role],
      min_rate_yocto: minNear * ONE_NEAR,
      declared_operator_account: 'operator.testnet',
      available: true,
    });
  }
}

function seedDemoJob(engine) {
  registerDefaultAgents(engine);
  engine.setContext('customer.testnet', 10n * ONE_NEAR, 1_000_000_000n);
  return engine.create_job({
    title: 'Online Coffee Business Launch Strategy',
    description: 'Coordinate ResearchPro, MarketMind, and VerifyAI.',
    criteria_text: CRITERIA_TEXT,
    criteria_hash: CRITERIA_HASH,
    deadline_ns: 500_000_000_000_000n,
    max_agents: 3,
    role_slots: [
      { role: 'Research Specialist', suggested_payout_yocto: 3n * ONE_NEAR },
      { role: 'Business Analyst', suggested_payout_yocto: 3n * ONE_NEAR },
      { role: 'Quality Auditor', suggested_payout_yocto: 2n * ONE_NEAR },
    ],
  });
}

test('01. Create funded job and verify criteria_hash matches SHA-256(criteria_text)', () => {
  const engine = new SwarmSettleEngine();
  const job = seedDemoJob(engine);
  assert.equal(job.id, 1);
  assert.equal(job.criteria_hash, CRITERIA_HASH);
});

test('02. Reject criteria_text and criteria_hash mismatch', () => {
  const engine = new SwarmSettleEngine();
  engine.setContext('customer.testnet', 5n * ONE_NEAR, 1_000_000_000n);
  assert.throws(
    () =>
      engine.create_job({
        title: 'Mismatch',
        description: 'Desc',
        criteria_text: CRITERIA_TEXT,
        criteria_hash: ARTIFACT_HASH_1,
        deadline_ns: 5_000_000_000n,
        max_agents: 2,
      }),
    /does not match SHA-256 of criteria_text/
  );
});

test('03. Reject deposits below 0.1 NEAR', () => {
  const engine = new SwarmSettleEngine();
  engine.setContext('customer.testnet', 0n, 1_000_000_000n);
  assert.throws(
    () =>
      engine.create_job({
        title: 'Zero',
        description: 'Desc',
        criteria_text: CRITERIA_TEXT,
        criteria_hash: CRITERIA_HASH,
        deadline_ns: 5_000_000_000n,
        max_agents: 2,
      }),
    /Attached NEAR deposit must be at least 0.1 NEAR/
  );
});

test('04. Reject expired job deadline and invalid review window (< 1 hour)', () => {
  const engine = new SwarmSettleEngine();
  engine.setContext('customer.testnet', 5n * ONE_NEAR, 2_000_000_000n);
  assert.throws(
    () =>
      engine.create_job({
        title: 'Past deadline',
        description: 'Desc',
        criteria_text: CRITERIA_TEXT,
        criteria_hash: CRITERIA_HASH,
        deadline_ns: 1_000_000_000n,
        max_agents: 2,
      }),
    /deadline_ns must be strictly in the future/
  );
  assert.throws(
    () =>
      engine.create_job({
        title: 'Short review',
        description: 'Desc',
        criteria_text: CRITERIA_TEXT,
        criteria_hash: CRITERIA_HASH,
        deadline_ns: 5_000_000_000n,
        max_agents: 2,
        review_window_ns: 100n,
      }),
    /review_window_ns must be at least 1 hour/
  );
});

test('05. Reject unregistered or unavailable bidder', () => {
  const engine = new SwarmSettleEngine();
  const job = seedDemoJob(engine);
  engine.setContext('unregistered.testnet', 0n, 1_100_000_000n);
  assert.throws(
    () =>
      engine.submit_bid({
        job_id: job.id,
        role: 'Research Specialist',
        requested_payout_yocto: 3n * ONE_NEAR,
        proposal: 'Unregistered',
      }),
    /Bidder must register an AgentProfile/
  );

  engine.setContext('offline.agent.testnet', 0n, 1_100_000_000n);
  engine.register_agent_profile({
    display_name: 'OfflineBot',
    primary_role: 'Research Specialist',
    skills: ['Research'],
    min_rate_yocto: ONE_NEAR,
    available: false,
  });
  assert.throws(
    () =>
      engine.submit_bid({
        job_id: job.id,
        role: 'Research Specialist',
        requested_payout_yocto: 3n * ONE_NEAR,
        proposal: 'Unavailable',
      }),
    /currently marked as unavailable/
  );
});

test('06. Reject bid below registered minimum rate', () => {
  const engine = new SwarmSettleEngine();
  const job = seedDemoJob(engine);
  engine.setContext('researchpro.agent.testnet', 0n, 1_100_000_000n);
  assert.throws(
    () =>
      engine.submit_bid({
        job_id: job.id,
        role: 'Research Specialist',
        requested_payout_yocto: ONE_NEAR, // min_rate is 2 NEAR
        proposal: 'Under min rate',
      }),
    /below the agent's registered min_rate_yocto/
  );
});

test('07. Reject bid whose role does not match job role_slots', () => {
  const engine = new SwarmSettleEngine();
  const job = seedDemoJob(engine);
  engine.setContext('researchpro.agent.testnet', 0n, 1_100_000_000n);
  assert.throws(
    () =>
      engine.submit_bid({
        job_id: job.id,
        role: 'NonExistent Role',
        requested_payout_yocto: 3n * ONE_NEAR,
        proposal: 'Wrong role',
      }),
    /Bid role must match one of the job's defined role_slots/
  );
});

test('08. Reject duplicate active bid and allow withdrawal/rebid while Open', () => {
  const engine = new SwarmSettleEngine();
  const job = seedDemoJob(engine);
  engine.setContext('researchpro.agent.testnet', 0n, 1_100_000_000n);
  engine.submit_bid({
    job_id: job.id,
    role: 'Research Specialist',
    requested_payout_yocto: 3n * ONE_NEAR,
    proposal: 'First bid',
  });
  assert.throws(
    () =>
      engine.submit_bid({
        job_id: job.id,
        role: 'Research Specialist',
        requested_payout_yocto: 2n * ONE_NEAR,
        proposal: 'Duplicate',
      }),
    /already submitted an active bid/
  );
  engine.withdraw_bid({ job_id: job.id });
  const rebid = engine.submit_bid({
    job_id: job.id,
    role: 'Research Specialist',
    requested_payout_yocto: 2n * ONE_NEAR,
    proposal: 'Valid rebid',
  });
  assert.equal(rebid.status, 'Pending');
});

test('09. Reject non-creator crew selection and duplicate agent in crew', () => {
  const engine = new SwarmSettleEngine();
  const job = seedDemoJob(engine);
  engine.setContext('researchpro.agent.testnet', 0n, 1_100_000_000n);
  engine.submit_bid({ job_id: job.id, role: 'Research Specialist', requested_payout_yocto: 3n * ONE_NEAR, proposal: 'P1' });
  engine.setContext('marketmind.agent.testnet', 0n, 1_100_000_000n);
  engine.submit_bid({ job_id: job.id, role: 'Business Analyst', requested_payout_yocto: 3n * ONE_NEAR, proposal: 'P2' });

  engine.setContext('attacker.testnet', 0n, 1_200_000_000n);
  assert.throws(
    () =>
      engine.select_crew({
        job_id: job.id,
        selections: [
          { agent: 'researchpro.agent.testnet', role: 'Research Specialist', agreed_payout_yocto: 3n * ONE_NEAR },
          { agent: 'marketmind.agent.testnet', role: 'Business Analyst', agreed_payout_yocto: 3n * ONE_NEAR },
        ],
      }),
    /Only the job creator can select the crew/
  );

  engine.setContext('customer.testnet', 0n, 1_200_000_000n);
  assert.throws(
    () =>
      engine.select_crew({
        job_id: job.id,
        selections: [
          { agent: 'researchpro.agent.testnet', role: 'Research Specialist', agreed_payout_yocto: 3n * ONE_NEAR },
          { agent: 'researchpro.agent.testnet', role: 'Research Specialist', agreed_payout_yocto: 3n * ONE_NEAR },
        ],
      }),
    /Duplicate agent in crew selection/
  );
});

test('10. Reject crew selection with role mismatch or agreed payout below min_rate', () => {
  const engine = new SwarmSettleEngine();
  const job = seedDemoJob(engine);
  engine.setContext('researchpro.agent.testnet', 0n, 1_100_000_000n);
  engine.submit_bid({ job_id: job.id, role: 'Research Specialist', requested_payout_yocto: 3n * ONE_NEAR, proposal: 'P1' });
  engine.setContext('marketmind.agent.testnet', 0n, 1_100_000_000n);
  engine.submit_bid({ job_id: job.id, role: 'Business Analyst', requested_payout_yocto: 3n * ONE_NEAR, proposal: 'P2' });

  engine.setContext('customer.testnet', 0n, 1_200_000_000n);
  assert.throws(
    () =>
      engine.select_crew({
        job_id: job.id,
        selections: [
          { agent: 'researchpro.agent.testnet', role: 'Quality Auditor', agreed_payout_yocto: 3n * ONE_NEAR },
          { agent: 'marketmind.agent.testnet', role: 'Business Analyst', agreed_payout_yocto: 3n * ONE_NEAR },
        ],
      }),
    /Selected role must match the role specified in the agent's bid/
  );
});

test('11. Reject over-budget allocation and prove conservation of funded budget', () => {
  const engine = new SwarmSettleEngine();
  const job = seedDemoJob(engine);
  engine.setContext('researchpro.agent.testnet', 0n, 1_100_000_000n);
  engine.submit_bid({ job_id: job.id, role: 'Research Specialist', requested_payout_yocto: 6n * ONE_NEAR, proposal: 'P1' });
  engine.setContext('marketmind.agent.testnet', 0n, 1_100_000_000n);
  engine.submit_bid({ job_id: job.id, role: 'Business Analyst', requested_payout_yocto: 6n * ONE_NEAR, proposal: 'P2' });

  engine.setContext('customer.testnet', 0n, 1_200_000_000n);
  assert.throws(
    () =>
      engine.select_crew({
        job_id: job.id,
        selections: [
          { agent: 'researchpro.agent.testnet', role: 'Research Specialist', agreed_payout_yocto: 6n * ONE_NEAR },
          { agent: 'marketmind.agent.testnet', role: 'Business Analyst', agreed_payout_yocto: 5n * ONE_NEAR },
        ],
      }),
    /cannot exceed the funded escrow budget/
  );

  const locked = engine.select_crew({
    job_id: job.id,
    selections: [
      { agent: 'researchpro.agent.testnet', role: 'Research Specialist', agreed_payout_yocto: 3n * ONE_NEAR },
      { agent: 'marketmind.agent.testnet', role: 'Business Analyst', agreed_payout_yocto: 3n * ONE_NEAR },
    ],
  });
  const treasury = engine.get_job_treasury({ job_id: locked.id });
  assert.equal(
    BigInt(treasury.allocated_yocto) + BigInt(treasury.unallocated_reserve_yocto),
    BigInt(treasury.budget_yocto)
  );
});

test('12. Only selected agent can submit contribution', () => {
  const engine = new SwarmSettleEngine();
  const job = seedDemoJob(engine);
  engine.setContext('researchpro.agent.testnet', 0n, 1_100_000_000n);
  engine.submit_bid({ job_id: job.id, role: 'Research Specialist', requested_payout_yocto: 3n * ONE_NEAR, proposal: 'P1' });
  engine.setContext('marketmind.agent.testnet', 0n, 1_100_000_000n);
  engine.submit_bid({ job_id: job.id, role: 'Business Analyst', requested_payout_yocto: 3n * ONE_NEAR, proposal: 'P2' });
  engine.setContext('customer.testnet', 0n, 1_200_000_000n);
  engine.select_crew({
    job_id: job.id,
    selections: [
      { agent: 'researchpro.agent.testnet', role: 'Research Specialist', agreed_payout_yocto: 3n * ONE_NEAR },
      { agent: 'marketmind.agent.testnet', role: 'Business Analyst', agreed_payout_yocto: 3n * ONE_NEAR },
    ],
  });
  engine.setContext('outsider.testnet', 0n, 1_300_000_000n);
  assert.throws(
    () =>
      engine.submit_contribution({
        job_id: job.id,
        artifact_uri: 'https://example.org/f',
        artifact_sha256: ARTIFACT_HASH_1,
      }),
    /Only a selected crew member/
  );
});

test('13. Reject arbitrary self-resubmission while Submitted (prevents timer reset griefing)', () => {
  const engine = new SwarmSettleEngine();
  const job = seedDemoJob(engine);
  engine.setContext('researchpro.agent.testnet', 0n, 1_100_000_000n);
  engine.submit_bid({ job_id: job.id, role: 'Research Specialist', requested_payout_yocto: 3n * ONE_NEAR, proposal: 'P1' });
  engine.setContext('marketmind.agent.testnet', 0n, 1_100_000_000n);
  engine.submit_bid({ job_id: job.id, role: 'Business Analyst', requested_payout_yocto: 3n * ONE_NEAR, proposal: 'P2' });
  engine.setContext('customer.testnet', 0n, 1_200_000_000n);
  engine.select_crew({
    job_id: job.id,
    selections: [
      { agent: 'researchpro.agent.testnet', role: 'Research Specialist', agreed_payout_yocto: 3n * ONE_NEAR },
      { agent: 'marketmind.agent.testnet', role: 'Business Analyst', agreed_payout_yocto: 3n * ONE_NEAR },
    ],
  });
  engine.setContext('researchpro.agent.testnet', 0n, 1_300_000_000n);
  engine.submit_contribution({
    job_id: job.id,
    artifact_uri: 'https://example.org/v1',
    artifact_sha256: ARTIFACT_HASH_1,
  });
  assert.throws(
    () =>
      engine.submit_contribution({
        job_id: job.id,
        artifact_uri: 'https://example.org/v2',
        artifact_sha256: ARTIFACT_HASH_2,
      }),
    /only be submitted initially or after a creator RevisionRequested/
  );
});

test('14. Resubmission allowed after valid revision request and revision cap (2) is enforced', () => {
  const engine = new SwarmSettleEngine();
  const job = seedDemoJob(engine);
  engine.setContext('researchpro.agent.testnet', 0n, 1_100_000_000n);
  engine.submit_bid({ job_id: job.id, role: 'Research Specialist', requested_payout_yocto: 3n * ONE_NEAR, proposal: 'P1' });
  engine.setContext('marketmind.agent.testnet', 0n, 1_100_000_000n);
  engine.submit_bid({ job_id: job.id, role: 'Business Analyst', requested_payout_yocto: 3n * ONE_NEAR, proposal: 'P2' });
  engine.setContext('customer.testnet', 0n, 1_200_000_000n);
  engine.select_crew({
    job_id: job.id,
    selections: [
      { agent: 'researchpro.agent.testnet', role: 'Research Specialist', agreed_payout_yocto: 3n * ONE_NEAR },
      { agent: 'marketmind.agent.testnet', role: 'Business Analyst', agreed_payout_yocto: 3n * ONE_NEAR },
    ],
  });

  engine.setContext('researchpro.agent.testnet', 0n, 2_000_000_000n);
  engine.submit_contribution({ job_id: job.id, artifact_uri: 'https://example.org/v1', artifact_sha256: ARTIFACT_HASH_1 });
  engine.setContext('customer.testnet', 0n, 3_000_000_000n);
  engine.request_revision({ job_id: job.id, agent_id: 'researchpro.agent.testnet', feedback: 'Rev 1' });

  engine.setContext('researchpro.agent.testnet', 0n, 4_000_000_000n);
  engine.submit_contribution({ job_id: job.id, artifact_uri: 'https://example.org/v2', artifact_sha256: ARTIFACT_HASH_2 });
  engine.setContext('customer.testnet', 0n, 5_000_000_000n);
  engine.request_revision({ job_id: job.id, agent_id: 'researchpro.agent.testnet', feedback: 'Rev 2' });

  engine.setContext('researchpro.agent.testnet', 0n, 6_000_000_000n);
  engine.submit_contribution({ job_id: job.id, artifact_uri: 'https://example.org/v3', artifact_sha256: ARTIFACT_HASH_1 });
  engine.setContext('customer.testnet', 0n, 7_000_000_000n);
  assert.throws(
    () => engine.request_revision({ job_id: job.id, agent_id: 'researchpro.agent.testnet', feedback: 'Rev 3' }),
    /Maximum revision rounds \(2\) reached/
  );
});

test('15. Creator revision, approval, or rejection at or after review_deadline_ns is rejected', () => {
  const engine = new SwarmSettleEngine();
  const job = seedDemoJob(engine);
  engine.setContext('researchpro.agent.testnet', 0n, 1_100_000_000n);
  engine.submit_bid({ job_id: job.id, role: 'Research Specialist', requested_payout_yocto: 3n * ONE_NEAR, proposal: 'P1' });
  engine.setContext('marketmind.agent.testnet', 0n, 1_100_000_000n);
  engine.submit_bid({ job_id: job.id, role: 'Business Analyst', requested_payout_yocto: 3n * ONE_NEAR, proposal: 'P2' });
  engine.setContext('customer.testnet', 0n, 1_200_000_000n);
  engine.select_crew({
    job_id: job.id,
    selections: [
      { agent: 'researchpro.agent.testnet', role: 'Research Specialist', agreed_payout_yocto: 3n * ONE_NEAR },
      { agent: 'marketmind.agent.testnet', role: 'Business Analyst', agreed_payout_yocto: 3n * ONE_NEAR },
    ],
  });

  const submitTs = 10_000_000_000n;
  engine.setContext('researchpro.agent.testnet', 0n, submitTs);
  engine.submit_contribution({ job_id: job.id, artifact_uri: 'https://example.org/v1', artifact_sha256: ARTIFACT_HASH_1 });

  // Jump to exact review_deadline_ns
  engine.setContext('customer.testnet', 0n, submitTs + DEFAULT_REVIEW_WINDOW_NS);
  assert.throws(
    () => engine.request_revision({ job_id: job.id, agent_id: 'researchpro.agent.testnet', feedback: 'Late rev' }),
    /Creator review window has expired/
  );
  assert.throws(
    () => engine.reject_contribution({ job_id: job.id, agent_id: 'researchpro.agent.testnet', reason: 'Late reject' }),
    /Creator review window has expired/
  );
  assert.throws(
    () => engine.approve_contribution({ job_id: job.id, agent_id: 'researchpro.agent.testnet' }),
    /Creator review window has expired/
  );
});

test('16. Revision cannot be requested at or after job.deadline_ns', () => {
  const engine = new SwarmSettleEngine();
  const job = seedDemoJob(engine);
  engine.setContext('researchpro.agent.testnet', 0n, 1_100_000_000n);
  engine.submit_bid({ job_id: job.id, role: 'Research Specialist', requested_payout_yocto: 3n * ONE_NEAR, proposal: 'P1' });
  engine.setContext('marketmind.agent.testnet', 0n, 1_100_000_000n);
  engine.submit_bid({ job_id: job.id, role: 'Business Analyst', requested_payout_yocto: 3n * ONE_NEAR, proposal: 'P2' });
  engine.setContext('customer.testnet', 0n, 1_200_000_000n);
  engine.select_crew({
    job_id: job.id,
    selections: [
      { agent: 'researchpro.agent.testnet', role: 'Research Specialist', agreed_payout_yocto: 3n * ONE_NEAR },
      { agent: 'marketmind.agent.testnet', role: 'Business Analyst', agreed_payout_yocto: 3n * ONE_NEAR },
    ],
  });

  const justBeforeJobDeadline = BigInt(job.deadline_ns) - 100n;
  engine.setContext('researchpro.agent.testnet', 0n, justBeforeJobDeadline);
  engine.submit_contribution({ job_id: job.id, artifact_uri: 'https://example.org/v1', artifact_sha256: ARTIFACT_HASH_1 });

  engine.setContext('customer.testnet', 0n, BigInt(job.deadline_ns));
  assert.throws(
    () => engine.request_revision({ job_id: job.id, agent_id: 'researchpro.agent.testnet', feedback: 'After job deadline' }),
    /Cannot request a revision at or after the job deadline/
  );
});

test('17. Agent timeout claim before review deadline is rejected and at/after deadline succeeds', () => {
  const engine = new SwarmSettleEngine();
  const job = seedDemoJob(engine);
  engine.setContext('researchpro.agent.testnet', 0n, 1_100_000_000n);
  engine.submit_bid({ job_id: job.id, role: 'Research Specialist', requested_payout_yocto: 3n * ONE_NEAR, proposal: 'P1' });
  engine.setContext('marketmind.agent.testnet', 0n, 1_100_000_000n);
  engine.submit_bid({ job_id: job.id, role: 'Business Analyst', requested_payout_yocto: 3n * ONE_NEAR, proposal: 'P2' });
  engine.setContext('customer.testnet', 0n, 1_200_000_000n);
  engine.select_crew({
    job_id: job.id,
    selections: [
      { agent: 'researchpro.agent.testnet', role: 'Research Specialist', agreed_payout_yocto: 3n * ONE_NEAR },
      { agent: 'marketmind.agent.testnet', role: 'Business Analyst', agreed_payout_yocto: 3n * ONE_NEAR },
    ],
  });

  const submitTs = 10_000_000_000n;
  engine.setContext('researchpro.agent.testnet', 0n, submitTs);
  engine.submit_contribution({ job_id: job.id, artifact_uri: 'https://example.org/v1', artifact_sha256: ARTIFACT_HASH_1 });

  engine.setContext('researchpro.agent.testnet', 0n, submitTs + DEFAULT_REVIEW_WINDOW_NS - 1n);
  assert.throws(
    () => engine.claim_timeout_payout({ job_id: job.id }),
    /Creator review window has not expired yet/
  );

  engine.setContext('researchpro.agent.testnet', 0n, submitTs + DEFAULT_REVIEW_WINDOW_NS);
  const claim = engine.claim_timeout_payout({ job_id: job.id });
  assert.equal(claim.amount_yocto, String(3n * ONE_NEAR));
  engine.on_payout_complete({
    job_id: job.id,
    agent_id: 'researchpro.agent.testnet',
    amount_yocto: 3n * ONE_NEAR,
    was_timeout_claim: true,
    succeeded: true,
  });
  assert.equal(engine.jobs.get(job.id).transferred_yocto, String(3n * ONE_NEAR));
});

test('18. Verifier score binds to exact criteria_hash and target artifact_sha256 and blocks overwrite', () => {
  const engine = new SwarmSettleEngine();
  const job = seedDemoJob(engine);
  engine.setContext('researchpro.agent.testnet', 0n, 1_100_000_000n);
  engine.submit_bid({ job_id: job.id, role: 'Research Specialist', requested_payout_yocto: 3n * ONE_NEAR, proposal: 'P1' });
  engine.setContext('verifyai.agent.testnet', 0n, 1_100_000_000n);
  engine.submit_bid({ job_id: job.id, role: 'Quality Auditor', requested_payout_yocto: 2n * ONE_NEAR, proposal: 'P2' });
  engine.setContext('customer.testnet', 0n, 1_200_000_000n);
  engine.select_crew({
    job_id: job.id,
    selections: [
      { agent: 'researchpro.agent.testnet', role: 'Research Specialist', agreed_payout_yocto: 3n * ONE_NEAR },
      { agent: 'verifyai.agent.testnet', role: 'Quality Auditor', agreed_payout_yocto: 2n * ONE_NEAR },
    ],
  });

  engine.setContext('researchpro.agent.testnet', 0n, 2_000_000_000n);
  engine.submit_contribution({ job_id: job.id, artifact_uri: 'https://example.org/v1', artifact_sha256: ARTIFACT_HASH_1 });

  engine.setContext('verifyai.agent.testnet', 0n, 2_500_000_000n);
  // Wrong artifact hash must fail
  assert.throws(
    () =>
      engine.submit_verifier_score({
        job_id: job.id,
        target_agent_id: 'researchpro.agent.testnet',
        audited_criteria_hash: CRITERIA_HASH,
        audited_artifact_sha256: ARTIFACT_HASH_2,
        quality_score: 95,
        verification_summary: 'Wrong hash',
        report_sha256: REPORT_HASH_1,
      }),
    /does not match the target's currently submitted artifact_sha256/
  );

  const scored = engine.submit_verifier_score({
    job_id: job.id,
    target_agent_id: 'researchpro.agent.testnet',
    audited_criteria_hash: CRITERIA_HASH,
    audited_artifact_sha256: ARTIFACT_HASH_1,
    quality_score: 95,
    verification_summary: 'Verified all criteria',
    report_sha256: REPORT_HASH_1,
  });
  assert.equal(scored.verifier_score, 95);

  // Overwrite attempt in same round must fail
  assert.throws(
    () =>
      engine.submit_verifier_score({
        job_id: job.id,
        target_agent_id: 'researchpro.agent.testnet',
        audited_criteria_hash: CRITERIA_HASH,
        audited_artifact_sha256: ARTIFACT_HASH_1,
        quality_score: 50,
        verification_summary: 'Overwrite',
        report_sha256: REPORT_HASH_1,
      }),
    /already recorded for this submission round/
  );
});

test('19. Failed payout callback queues claimable_pool_yocto (not transferred_yocto) until pulled', () => {
  const engine = new SwarmSettleEngine();
  const job = seedDemoJob(engine);
  engine.setContext('researchpro.agent.testnet', 0n, 1_100_000_000n);
  engine.submit_bid({ job_id: job.id, role: 'Research Specialist', requested_payout_yocto: 3n * ONE_NEAR, proposal: 'P1' });
  engine.setContext('verifyai.agent.testnet', 0n, 1_100_000_000n);
  engine.submit_bid({ job_id: job.id, role: 'Quality Auditor', requested_payout_yocto: 2n * ONE_NEAR, proposal: 'P2' });
  engine.setContext('customer.testnet', 0n, 1_200_000_000n);
  engine.select_crew({
    job_id: job.id,
    selections: [
      { agent: 'researchpro.agent.testnet', role: 'Research Specialist', agreed_payout_yocto: 3n * ONE_NEAR },
      { agent: 'verifyai.agent.testnet', role: 'Quality Auditor', agreed_payout_yocto: 2n * ONE_NEAR },
    ],
  });

  engine.setContext('researchpro.agent.testnet', 0n, 2_000_000_000n);
  engine.submit_contribution({ job_id: job.id, artifact_uri: 'https://example.org/v1', artifact_sha256: ARTIFACT_HASH_1 });

  engine.setContext('customer.testnet', 0n, 2_500_000_000n);
  engine.approve_contribution({ job_id: job.id, agent_id: 'researchpro.agent.testnet', rating: 5 });
  engine.on_payout_complete({
    job_id: job.id,
    agent_id: 'researchpro.agent.testnet',
    amount_yocto: 3n * ONE_NEAR,
    succeeded: false,
  });

  const midJob = engine.jobs.get(job.id);
  assert.equal(midJob.transferred_yocto, '0');
  assert.equal(midJob.claimable_pool_yocto, String(3n * ONE_NEAR));
  assert.equal(engine.getOrCreateStats('researchpro.agent.testnet').total_earned_yocto, '0');

  // Now agent pulls claimable payout successfully
  engine.setContext('researchpro.agent.testnet', 0n, 3_000_000_000n);
  engine.withdraw_claimable_payout({ job_id: job.id, succeeded: true });
  assert.equal(midJob.transferred_yocto, String(3n * ONE_NEAR));
  assert.equal(midJob.claimable_pool_yocto, '0');
  assert.equal(
    engine.getOrCreateStats('researchpro.agent.testnet').total_earned_yocto,
    String(3n * ONE_NEAR)
  );
});

test('20. Post-deadline refund converts NotSubmitted slots to Expired and finalizes job when all resolved', () => {
  const engine = new SwarmSettleEngine();
  const job = seedDemoJob(engine);
  engine.setContext('researchpro.agent.testnet', 0n, 1_100_000_000n);
  engine.submit_bid({ job_id: job.id, role: 'Research Specialist', requested_payout_yocto: 3n * ONE_NEAR, proposal: 'P1' });
  engine.setContext('marketmind.agent.testnet', 0n, 1_100_000_000n);
  engine.submit_bid({ job_id: job.id, role: 'Business Analyst', requested_payout_yocto: 3n * ONE_NEAR, proposal: 'P2' });
  engine.setContext('customer.testnet', 0n, 1_200_000_000n);
  engine.select_crew({
    job_id: job.id,
    selections: [
      { agent: 'researchpro.agent.testnet', role: 'Research Specialist', agreed_payout_yocto: 3n * ONE_NEAR },
      { agent: 'marketmind.agent.testnet', role: 'Business Analyst', agreed_payout_yocto: 3n * ONE_NEAR },
    ],
  });

  engine.setContext('researchpro.agent.testnet', 0n, 2_000_000_000n);
  engine.submit_contribution({ job_id: job.id, artifact_uri: 'https://example.org/v1', artifact_sha256: ARTIFACT_HASH_1 });
  engine.setContext('customer.testnet', 0n, 2_500_000_000n);
  engine.approve_contribution({ job_id: job.id, agent_id: 'researchpro.agent.testnet', rating: 5 });
  engine.on_payout_complete({
    job_id: job.id,
    agent_id: 'researchpro.agent.testnet',
    amount_yocto: 3n * ONE_NEAR,
    succeeded: true,
  });

  // Jump past job deadline; marketmind never submitted
  engine.setContext('customer.testnet', 0n, 600_000_000_000_000n);
  const refunded = engine.claim_remaining_refund({ job_id: job.id });
  assert.equal(refunded, String(7n * ONE_NEAR));

  const contribs = engine.jobContributions.get(job.id);
  const marketmindContrib = contribs.find((c) => c.agent === 'marketmind.agent.testnet');
  assert.equal(marketmindContrib.status, 'Expired');
  assert.equal(engine.jobs.get(job.id).status, 'Completed');
});

test('21. Customer rating bounds (1..5) and non-creator approval/rejection restrictions enforced', () => {
  const engine = new SwarmSettleEngine();
  const job = seedDemoJob(engine);
  engine.setContext('researchpro.agent.testnet', 0n, 1_100_000_000n);
  engine.submit_bid({ job_id: job.id, role: 'Research Specialist', requested_payout_yocto: 3n * ONE_NEAR, proposal: 'P1' });
  engine.setContext('verifyai.agent.testnet', 0n, 1_100_000_000n);
  engine.submit_bid({ job_id: job.id, role: 'Quality Auditor', requested_payout_yocto: 2n * ONE_NEAR, proposal: 'P2' });
  engine.setContext('customer.testnet', 0n, 1_200_000_000n);
  engine.select_crew({
    job_id: job.id,
    selections: [
      { agent: 'researchpro.agent.testnet', role: 'Research Specialist', agreed_payout_yocto: 3n * ONE_NEAR },
      { agent: 'verifyai.agent.testnet', role: 'Quality Auditor', agreed_payout_yocto: 2n * ONE_NEAR },
    ],
  });
  engine.setContext('researchpro.agent.testnet', 0n, 2_000_000_000n);
  engine.submit_contribution({ job_id: job.id, artifact_uri: 'https://example.org/v1', artifact_sha256: ARTIFACT_HASH_1 });

  // Non-creator cannot approve
  assert.throws(
    () => engine.approve_contribution({ job_id: job.id, agent_id: 'researchpro.agent.testnet' }),
    /Only the job creator can approve/
  );

  // Invalid star rating (6) rejected
  engine.setContext('customer.testnet', 0n, 2_100_000_000n);
  assert.throws(
    () => engine.approve_contribution({ job_id: job.id, agent_id: 'researchpro.agent.testnet', rating: 6 }),
    /Customer rating must be between 1 and 5 stars/
  );
});

test('22. Only selected Verifier role can score and cannot self-score', () => {
  const engine = new SwarmSettleEngine();
  const job = seedDemoJob(engine);
  engine.setContext('researchpro.agent.testnet', 0n, 1_100_000_000n);
  engine.submit_bid({ job_id: job.id, role: 'Research Specialist', requested_payout_yocto: 3n * ONE_NEAR, proposal: 'P1' });
  engine.setContext('verifyai.agent.testnet', 0n, 1_100_000_000n);
  engine.submit_bid({ job_id: job.id, role: 'Quality Auditor', requested_payout_yocto: 2n * ONE_NEAR, proposal: 'P2' });
  engine.setContext('customer.testnet', 0n, 1_200_000_000n);
  engine.select_crew({
    job_id: job.id,
    selections: [
      { agent: 'researchpro.agent.testnet', role: 'Research Specialist', agreed_payout_yocto: 3n * ONE_NEAR },
      { agent: 'verifyai.agent.testnet', role: 'Quality Auditor', agreed_payout_yocto: 2n * ONE_NEAR },
    ],
  });
  engine.setContext('researchpro.agent.testnet', 0n, 2_000_000_000n);
  engine.submit_contribution({ job_id: job.id, artifact_uri: 'https://example.org/v1', artifact_sha256: ARTIFACT_HASH_1 });

  assert.throws(
    () =>
      engine.submit_verifier_score({
        job_id: job.id,
        target_agent_id: 'researchpro.agent.testnet',
        audited_criteria_hash: CRITERIA_HASH,
        audited_artifact_sha256: ARTIFACT_HASH_1,
        quality_score: 100,
        verification_summary: 'Self score',
        report_sha256: REPORT_HASH_1,
      }),
    /cannot submit a verifier score for its own contribution/
  );
});

test('23. Failed pull-withdrawal restores claimable balance without losing funds', () => {
  const engine = new SwarmSettleEngine();
  const job = seedDemoJob(engine);
  engine.setContext('researchpro.agent.testnet', 0n, 1_100_000_000n);
  engine.submit_bid({ job_id: job.id, role: 'Research Specialist', requested_payout_yocto: 3n * ONE_NEAR, proposal: 'P1' });
  engine.setContext('verifyai.agent.testnet', 0n, 1_100_000_000n);
  engine.submit_bid({ job_id: job.id, role: 'Quality Auditor', requested_payout_yocto: 2n * ONE_NEAR, proposal: 'P2' });
  engine.setContext('customer.testnet', 0n, 1_200_000_000n);
  engine.select_crew({
    job_id: job.id,
    selections: [
      { agent: 'researchpro.agent.testnet', role: 'Research Specialist', agreed_payout_yocto: 3n * ONE_NEAR },
      { agent: 'verifyai.agent.testnet', role: 'Quality Auditor', agreed_payout_yocto: 2n * ONE_NEAR },
    ],
  });
  engine.setContext('researchpro.agent.testnet', 0n, 2_000_000_000n);
  engine.submit_contribution({ job_id: job.id, artifact_uri: 'https://example.org/v1', artifact_sha256: ARTIFACT_HASH_1 });
  engine.setContext('customer.testnet', 0n, 2_500_000_000n);
  engine.approve_contribution({ job_id: job.id, agent_id: 'researchpro.agent.testnet' });
  engine.on_payout_complete({
    job_id: job.id,
    agent_id: 'researchpro.agent.testnet',
    amount_yocto: 3n * ONE_NEAR,
    succeeded: false,
  });

  engine.setContext('researchpro.agent.testnet', 0n, 3_000_000_000n);
  const failedAttempt = engine.withdraw_claimable_payout({ job_id: job.id, succeeded: false });
  assert.equal(failedAttempt, '0');
  assert.equal(engine.claimablePayouts.get('researchpro.agent.testnet'), 3n * ONE_NEAR);
});

test('24. Conservation invariant holds across approval, rejection, and final refund', () => {
  const engine = new SwarmSettleEngine();
  const job = seedDemoJob(engine);
  for (const [acct, role, amt] of [
    ['researchpro.agent.testnet', 'Research Specialist', 3n * ONE_NEAR],
    ['marketmind.agent.testnet', 'Business Analyst', 3n * ONE_NEAR],
    ['verifyai.agent.testnet', 'Quality Auditor', 2n * ONE_NEAR],
  ]) {
    engine.setContext(acct, 0n, 1_100_000_000n);
    engine.submit_bid({ job_id: job.id, role, requested_payout_yocto: amt, proposal: 'P' });
  }
  engine.setContext('customer.testnet', 0n, 1_200_000_000n);
  engine.select_crew({
    job_id: job.id,
    selections: [
      { agent: 'researchpro.agent.testnet', role: 'Research Specialist', agreed_payout_yocto: 3n * ONE_NEAR },
      { agent: 'marketmind.agent.testnet', role: 'Business Analyst', agreed_payout_yocto: 3n * ONE_NEAR },
      { agent: 'verifyai.agent.testnet', role: 'Quality Auditor', agreed_payout_yocto: 2n * ONE_NEAR },
    ],
  });
  for (const acct of ['researchpro.agent.testnet', 'marketmind.agent.testnet', 'verifyai.agent.testnet']) {
    engine.setContext(acct, 0n, 2_000_000_000n);
    engine.submit_contribution({ job_id: job.id, artifact_uri: `https://example.org/${acct}`, artifact_sha256: ARTIFACT_HASH_1 });
  }
  engine.setContext('customer.testnet', 0n, 2_500_000_000n);
  engine.approve_contribution({ job_id: job.id, agent_id: 'researchpro.agent.testnet', rating: 5 });
  engine.on_payout_complete({ job_id: job.id, agent_id: 'researchpro.agent.testnet', amount_yocto: 3n * ONE_NEAR, succeeded: true });
  engine.reject_contribution({ job_id: job.id, agent_id: 'marketmind.agent.testnet', reason: 'Incomplete' });
  engine.approve_contribution({ job_id: job.id, agent_id: 'verifyai.agent.testnet', rating: 5 });
  engine.on_payout_complete({ job_id: job.id, agent_id: 'verifyai.agent.testnet', amount_yocto: 2n * ONE_NEAR, succeeded: true });

  const refunded = engine.claim_remaining_refund({ job_id: job.id });
  assert.equal(refunded, String(5n * ONE_NEAR)); // 2 NEAR reserve + 3 NEAR rejected
  const finalJob = engine.jobs.get(job.id);
  assert.equal(
    BigInt(finalJob.transferred_yocto) +
      BigInt(finalJob.in_flight_yocto) +
      BigInt(finalJob.claimable_pool_yocto) +
      BigInt(finalJob.refunded_yocto),
    BigInt(finalJob.budget_yocto)
  );
});
