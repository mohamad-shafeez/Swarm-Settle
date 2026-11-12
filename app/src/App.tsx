import React, { useState, useEffect, useRef } from 'react';
import { formatYoctoToNear, parseNearToYocto, YOCTO_PER_NEAR } from './lib/yocto';
import { sha256HexFromText, sha256HexFromBytes, sha256HexFromFile } from './lib/hashing';
import {
  getNearConfig,
  callNearViewMethod,
  connectNearWallet,
  disconnectNearWallet,
  resolveWalletCallbackState,
  signAndSendContractCall,
  getTxExplorerUrl,
  getAccountExplorerUrl,
} from './lib/near';

export interface RoleSlotInput {
  role: string;
  suggested_payout_yocto: string;
}

export interface CrewSelectionInput {
  agent: string;
  role: string;
  agreed_payout_yocto: string;
}

export interface JobRecord {
  id: number;
  creator: string;
  title: string;
  description: string;
  criteria_text: string;
  criteria_hash: string;
  role_slots: RoleSlotInput[];
  deadline_ns: string;
  review_window_ns: string;
  status: 'Open' | 'CrewSelected' | 'InProgress' | 'Completed' | 'Cancelled';
  budget_yocto: string;
  allocated_yocto: string;
  transferred_yocto: string;
  in_flight_yocto: string;
  claimable_pool_yocto: string;
  refunded_yocto: string;
  max_agents: number;
  selected_agents: string[];
  created_at_ns?: string;
  updated_at_ns?: string;
}

export interface BidRecord {
  job_id: number;
  agent: string;
  role: string;
  requested_payout_yocto: string;
  proposal: string;
  estimated_hours: number;
  status: 'Pending' | 'Selected' | 'NotSelected' | 'Withdrawn';
  exclusion_reason?: string;
}

export interface ContributionRecord {
  job_id: number;
  agent: string;
  role: string;
  agreed_payout_yocto: string;
  artifact_uri: string;
  artifact_sha256: string;
  artifact_bytes_text?: string;
  evidence_notes: string;
  feedback_reason: string;
  status:
    | 'NotSubmitted'
    | 'Submitted'
    | 'RevisionRequested'
    | 'PayoutPending'
    | 'Paid'
    | 'ApprovedClaimable'
    | 'Rejected'
    | 'Expired';
  submission_count: number;
  revision_count: number;
  submitted_at_ns: string;
  review_deadline_ns: string;
  resubmit_deadline_ns?: string;
  resolved_at_ns?: string;
  verifier_score: number | null;
  verifier_summary: string;
  verifier_report_sha256: string;
  verifier_audited_criteria_hash: string;
  verifier_audited_artifact_sha256: string;
  verifier_agent: string | null;
  customer_rating: number | null;
}

export interface AgentProfileRecord {
  account_id: string;
  declared_operator_account: string;
  display_name: string;
  primary_role: string;
  specialty_summary: string;
  skills: string[];
  endpoint_or_handle: string;
  min_rate_yocto: string;
  available: boolean;
}

export interface AgentStatsRecord {
  account_id: string;
  bids_submitted: number;
  crews_selected: number;
  accepted_contributions: number;
  rejected_contributions: number;
  expired_contributions: number;
  revisions_requested: number;
  jobs_completed: number;
  on_time_deliveries: number;
  timeout_claims: number;
  rating_sum: number;
  rating_count: number;
  total_earned_yocto: string;
}

const DEFAULT_CRITERIA =
  '1. Research Specialist: Identify 5 specialty coffee competitors with pricing and roast positioning.\n' +
  '2. Business Analyst: Build subscription unit-economics model (CAC, LTV, gross margin, break-even bags/month).\n' +
  '3. Quality Auditor: Audit all submitted deliverables and verify completeness against criteria 1 & 2.';

const SAMPLE_DELIVERABLE_CONTENT: Record<string, string> = {
  'researchpro.agent.testnet': JSON.stringify(
    {
      schema: 'swarmsettle.deliverable.v1',
      job_id: 1,
      agent: 'researchpro.agent.testnet',
      role: 'Research Specialist',
      competitors: [
        { brand: 'Trade Coffee', bag_12oz_usd: 19.5, positioning: 'Curated multi-roaster marketplace' },
        { brand: 'Blue Bottle Subscription', bag_12oz_usd: 22.0, positioning: 'Single-origin specialty prestige' },
        { brand: 'Atlas Coffee Club', bag_12oz_usd: 17.0, positioning: 'Global country-of-the-month discovery' },
        { brand: 'Counter Culture Direct', bag_12oz_usd: 20.5, positioning: 'Transparent B-Corp direct trade' },
        { brand: 'Onyx Coffee Lab', bag_12oz_usd: 24.0, positioning: 'Ultra-premium micro-lot transparency' },
      ],
      recommended_wedge: 'Roast-to-order single-origin 2-bag biweekly club at $19.50/bag',
    },
    null,
    2
  ),
  'marketmind.agent.testnet': JSON.stringify(
    {
      schema: 'swarmsettle.deliverable.v1',
      job_id: 1,
      agent: 'marketmind.agent.testnet',
      role: 'Business Analyst',
      unit_economics: {
        price_per_shipment_usd: 39.0,
        landed_cogs_and_shipping_usd: 18.8,
        contribution_margin_pct: 51.8,
        target_cac_usd: 38.0,
        ltv_8_shipments_usd: 161.6,
        ltv_to_cac_ratio: 4.25,
        monthly_breakeven_bags: 412,
      },
    },
    null,
    2
  ),
  'verifyai.agent.testnet': JSON.stringify(
    {
      schema: 'swarmsettle.verifier-report.v1',
      job_id: 1,
      verifier_agent: 'verifyai.agent.testnet',
      advisory_only: true,
      evaluated_deliverables: ['researchpro.agent.testnet', 'marketmind.agent.testnet'],
      advisory_quality_score: 94,
      findings: 'Both deliverables satisfy criteria 1 and 2 with verifiable pricing and unit-economics models.',
    },
    null,
    2
  ),
};

/** Deterministic demo crew used by Simulation Preview mode. */
const DEMO_CREW = [
  {
    agent: 'researchpro.agent.testnet',
    role: 'Research Specialist',
    shareKey: 'researchpro.agent.testnet',
    artifactUri: 'examples/sample-simulation-output/researchpro.agent.testnet-deliverable-r1.json',
    evidenceNotes:
      '5-competitor specialty coffee teardown (Trade, Blue Bottle, Atlas, Counter Culture, Onyx).',
    verifierScore: 95,
    verifierSummary:
      'Advisory verification (95/100): All 5 competitor benchmarks and roast-to-order pricing verified against Criteria #1.',
  },
  {
    agent: 'marketmind.agent.testnet',
    role: 'Business Analyst',
    shareKey: 'marketmind.agent.testnet',
    artifactUri: 'examples/sample-simulation-output/marketmind.agent.testnet-deliverable-r1.json',
    evidenceNotes:
      'Subscription unit-economics model: 51.8% margin, 4.25x LTV:CAC, 412 bags/mo break-even.',
    verifierScore: 93,
    verifierSummary:
      'Advisory verification (93/100): CAC, LTV, gross margin, and break-even bag math verified against Criteria #2.',
  },
  {
    agent: 'verifyai.agent.testnet',
    role: 'Quality Auditor',
    shareKey: 'verifyai.agent.testnet',
    artifactUri: 'examples/sample-simulation-output/verifyai.agent.testnet-deliverable-r1.json',
    evidenceNotes:
      'Complete cross-deliverable audit report bound to criteria hash & file SHA-256 digests.',
    verifierScore: null,
    verifierSummary: 'Quality Auditor deliverable submitted; evaluated directly by customer.',
  },
] as const;

function buildDemoBids(jobId: number): BidRecord[] {
  return [
    {
      job_id: jobId,
      agent: 'researchpro.agent.testnet',
      role: 'Research Specialist',
      requested_payout_yocto: (3n * YOCTO_PER_NEAR).toString(),
      proposal: 'Benchmark 5 specialty coffee subscription competitors with pricing & positioning.',
      estimated_hours: 8,
      status: 'Pending',
    },
    {
      job_id: jobId,
      agent: 'marketmind.agent.testnet',
      role: 'Business Analyst',
      requested_payout_yocto: (3n * YOCTO_PER_NEAR).toString(),
      proposal: 'Build subscription pricing tiers, COGS breakdown, CAC/LTV & break-even model.',
      estimated_hours: 10,
      status: 'Pending',
    },
    {
      job_id: jobId,
      agent: 'verifyai.agent.testnet',
      role: 'Quality Auditor',
      requested_payout_yocto: (2n * YOCTO_PER_NEAR).toString(),
      proposal: 'Verify deliverable SHA-256 integrity and audit against criteria 1 & 2.',
      estimated_hours: 4,
      status: 'Pending',
    },
    {
      job_id: jobId,
      agent: 'codesmith.agent.testnet',
      role: 'Smart Contract Engineer',
      requested_payout_yocto: (4n * YOCTO_PER_NEAR).toString(),
      proposal: 'Write custom Rust staking contract modules.',
      estimated_hours: 12,
      status: 'NotSelected',
      exclusion_reason: 'Excluded: Mission defines no Software/Smart Contract role slot.',
    },
  ];
}

async function buildDemoContributions(
  jobId: number,
  criteriaText: string,
  sharesNear: Record<string, string>
): Promise<ContributionRecord[]> {
  const criteriaHash = await sha256HexFromText(criteriaText);
  const reportHash = await sha256HexFromText(
    SAMPLE_DELIVERABLE_CONTENT['verifyai.agent.testnet']
  );
  const nowNs = BigInt(Date.now()) * 1_000_000n;
  const reviewDeadlineNs = nowNs + 48n * 3600n * 1_000_000_000n;

  const rows = await Promise.all(
    DEMO_CREW.map(async (crew) => {
      const content = SAMPLE_DELIVERABLE_CONTENT[crew.agent];
      const artifactHash = await sha256HexFromText(content);
      return {
        job_id: jobId,
        agent: crew.agent,
        role: crew.role,
        agreed_payout_yocto: parseNearToYocto(sharesNear[crew.shareKey] || '0').toString(),
        artifact_uri: crew.artifactUri,
        artifact_sha256: artifactHash,
        artifact_bytes_text: content,
        evidence_notes: crew.evidenceNotes,
        feedback_reason: '',
        status: 'Submitted' as const,
        submission_count: 1,
        revision_count: 0,
        submitted_at_ns: nowNs.toString(),
        review_deadline_ns: reviewDeadlineNs.toString(),
        verifier_score: crew.verifierScore,
        verifier_summary: crew.verifierSummary,
        verifier_report_sha256: crew.verifierScore === null ? '' : reportHash,
        verifier_audited_criteria_hash: crew.verifierScore === null ? '' : criteriaHash,
        verifier_audited_artifact_sha256: crew.verifierScore === null ? '' : artifactHash,
        verifier_agent: crew.verifierScore === null ? null : 'verifyai.agent.testnet',
        customer_rating: null,
      };
    })
  );
  return rows;
}

export default function App() {
  const nearConfig = getNearConfig();
  const env = (import.meta as unknown as { env?: Record<string, string> }).env || {};
  const defaultLive = env.VITE_DEFAULT_LIVE === 'true' || Boolean(env.VITE_NEAR_CONTRACT_ID);

  const [executionMode, setExecutionMode] = useState<'LIVE_TESTNET' | 'SIMULATION'>(
    defaultLive ? 'LIVE_TESTNET' : 'SIMULATION'
  );
  const [connectedWallet, setConnectedWallet] = useState<string | null>(null);
  const [simSigner, setSimSigner] = useState<string>('customer.testnet');
  const [activeTab, setActiveTab] = useState<
    'dashboard' | 'create' | 'marketplace' | 'crew' | 'escrow'
  >('dashboard');
  const [statusBanner, setStatusBanner] = useState<{
    type: 'ok' | 'err';
    text: string;
    txHash?: string;
  } | null>(null);

  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [bids, setBids] = useState<BidRecord[]>([]);
  const [contributions, setContributions] = useState<ContributionRecord[]>([]);
  const [profiles, setProfiles] = useState<AgentProfileRecord[]>([]);
  const [agentStats, setAgentStats] = useState<Record<string, AgentStatsRecord>>({});
  const [selectedJobId, setSelectedJobId] = useState<number>(1);
  const [recentTxHashes, setRecentTxHashes] = useState<Array<{ label: string; txHash: string }>>([]);

  // Mission creation state
  const [title, setTitle] = useState<string>(
    'Launch an Online Specialty Coffee Subscription Business — Strategy & Financial Model'
  );
  const [description, setDescription] = useState<string>(
    'Coordinate a 3-agent specialist crew across Market Research, Unit-Economics Modeling, and Quality Verification.'
  );
  const [criteriaText, setCriteriaText] = useState<string>(DEFAULT_CRITERIA);
  const [criteriaHash, setCriteriaHash] = useState<string>('');
  const [budgetNear, setBudgetNear] = useState<string>('10');
  const maxAgents = 3;
  const uploadedBytesRef = useRef<Record<string, Uint8Array>>({});

  // Crew selection state (in NEAR)
  const [crewSharesNear, setCrewSharesNear] = useState<Record<string, string>>({
    'researchpro.agent.testnet': '3',
    'marketmind.agent.testnet': '3',
    'verifyai.agent.testnet': '2',
  });

  // Deliverable inspection & SHA-256 recompute state
  const [inspectedAgent, setInspectedAgent] = useState<string>('researchpro.agent.testnet');
  const [recomputedHashMap, setRecomputedHashMap] = useState<
    Record<string, { computedSha256: string; matches: boolean; byteLength: number }>
  >({});

  useEffect(() => {
    sha256HexFromText(criteriaText).then(setCriteriaHash).catch(() => {});
  }, [criteriaText]);

  useEffect(() => {
    const callbackState = resolveWalletCallbackState();
    if (callbackState.accountId) {
      setConnectedWallet(callbackState.accountId);
    }
    if (callbackState.lastTxHash) {
      setRecentTxHashes((prev) => [
        { label: 'Wallet Callback Transaction', txHash: callbackState.lastTxHash! },
        ...prev,
      ]);
      setStatusBanner({
        type: 'ok',
        text: `Confirmed NEAR Testnet transaction ${callbackState.lastTxHash}`,
        txHash: callbackState.lastTxHash,
      });
    } else if (callbackState.errorMessage) {
      setStatusBanner({
        type: 'err',
        text: `Wallet transaction error: ${callbackState.errorMessage}`,
      });
    }
  }, []);

  useEffect(() => {
    if (executionMode === 'LIVE_TESTNET') {
      loadLiveTestnetState();
    } else {
      seedSimulationPreview();
    }
  }, [executionMode]);

  async function loadLiveTestnetState(preferredJobId?: number) {
    try {
      const [liveJobs, liveProfiles] = await Promise.all([
        callNearViewMethod<JobRecord[]>('list_jobs', { from_index: 0, limit: 25 }),
        callNearViewMethod<AgentProfileRecord[]>('list_agent_profiles', {
          from_index: 0,
          limit: 50,
        }),
      ]);
      setJobs(liveJobs);
      setProfiles(liveProfiles);

      const statsEntries = await Promise.all(
        liveProfiles.map(async (p) => {
          try {
            const st = await callNearViewMethod<AgentStatsRecord>('get_agent_stats', {
              account_id: p.account_id,
            });
            return [p.account_id, st] as const;
          } catch {
            return [
              p.account_id,
              {
                account_id: p.account_id,
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
              },
            ] as const;
          }
        })
      );
      setAgentStats(Object.fromEntries(statsEntries));

      if (liveJobs.length > 0) {
        const targetId = preferredJobId || liveJobs[liveJobs.length - 1].id;
        setSelectedJobId(targetId);
        const [liveBids, liveContribs] = await Promise.all([
          callNearViewMethod<BidRecord[]>('list_bids', { job_id: targetId }),
          callNearViewMethod<ContributionRecord[]>('list_contributions', { job_id: targetId }),
        ]);
        setBids(liveBids);
        setContributions(liveContribs);
      } else {
        setBids([]);
        setContributions([]);
      }
    } catch (err) {
      setJobs([]);
      setBids([]);
      setContributions([]);
      setProfiles([]);
      setStatusBanner({
        type: 'err',
        text: `NEAR Testnet RPC query failed (${
          err instanceof Error ? err.message : 'Unreachable'
        }). Ensure contract ${nearConfig.contractId} is deployed on Testnet.`,
      });
    }
  }

  async function seedSimulationPreview() {
    const hash = await sha256HexFromText(DEFAULT_CRITERIA);

    setProfiles([
      {
        account_id: 'researchpro.agent.testnet',
        declared_operator_account: 'studio-alpha.testnet',
        display_name: 'ResearchPro',
        primary_role: 'Research Specialist',
        specialty_summary: 'Market sizing and 5-competitor teardown specialist.',
        skills: ['Market Research', 'Competitor Benchmarking'],
        endpoint_or_handle: 'https://example.org/agents/researchpro',
        min_rate_yocto: (2n * YOCTO_PER_NEAR).toString(),
        available: true,
      },
      {
        account_id: 'marketmind.agent.testnet',
        declared_operator_account: 'quant-ops.testnet',
        display_name: 'MarketMind',
        primary_role: 'Business Analyst',
        specialty_summary: 'Subscription unit economics, COGS, and CAC/LTV modeler.',
        skills: ['Unit Economics', 'Financial Modeling'],
        endpoint_or_handle: 'https://example.org/agents/marketmind',
        min_rate_yocto: (25n * YOCTO_PER_NEAR / 10n).toString(),
        available: true,
      },
      {
        account_id: 'verifyai.agent.testnet',
        declared_operator_account: 'audit-dao.testnet',
        display_name: 'VerifyAI',
        primary_role: 'Quality Auditor',
        specialty_summary: 'Evaluates deliverables against committed SHA-256 acceptance criteria.',
        skills: ['Criteria Auditing', 'SHA-256 Integrity Check'],
        endpoint_or_handle: 'https://example.org/agents/verifyai',
        min_rate_yocto: (15n * YOCTO_PER_NEAR / 10n).toString(),
        available: true,
      },
      {
        account_id: 'codesmith.agent.testnet',
        declared_operator_account: 'dev-guild.testnet',
        display_name: 'CodeSmith',
        primary_role: 'Smart Contract Engineer',
        specialty_summary: 'Rust smart contract engineering and WebAssembly optimization.',
        skills: ['Rust', 'NEAR SDK'],
        endpoint_or_handle: 'https://example.org/agents/codesmith',
        min_rate_yocto: (4n * YOCTO_PER_NEAR).toString(),
        available: true,
      },
    ]);

    setAgentStats({
      'researchpro.agent.testnet': {
        account_id: 'researchpro.agent.testnet',
        bids_submitted: 16,
        crews_selected: 14,
        accepted_contributions: 14,
        rejected_contributions: 0,
        expired_contributions: 0,
        revisions_requested: 1,
        jobs_completed: 14,
        on_time_deliveries: 14,
        timeout_claims: 0,
        rating_sum: 68,
        rating_count: 14,
        total_earned_yocto: (42n * YOCTO_PER_NEAR).toString(),
      },
      'marketmind.agent.testnet': {
        account_id: 'marketmind.agent.testnet',
        bids_submitted: 12,
        crews_selected: 11,
        accepted_contributions: 11,
        rejected_contributions: 0,
        expired_contributions: 0,
        revisions_requested: 0,
        jobs_completed: 11,
        on_time_deliveries: 11,
        timeout_claims: 0,
        rating_sum: 54,
        rating_count: 11,
        total_earned_yocto: (36n * YOCTO_PER_NEAR).toString(),
      },
      'verifyai.agent.testnet': {
        account_id: 'verifyai.agent.testnet',
        bids_submitted: 20,
        crews_selected: 19,
        accepted_contributions: 19,
        rejected_contributions: 0,
        expired_contributions: 0,
        revisions_requested: 0,
        jobs_completed: 19,
        on_time_deliveries: 19,
        timeout_claims: 0,
        rating_sum: 95,
        rating_count: 19,
        total_earned_yocto: (38n * YOCTO_PER_NEAR).toString(),
      },
    });

    setJobs([
      {
        id: 1,
        creator: 'customer.testnet',
        title: 'Launch an Online Specialty Coffee Subscription Business — Strategy & Financial Model',
        description:
          'Coordinate a 3-agent specialist crew across Market Research, Unit-Economics Modeling, and Quality Verification.',
        criteria_text: DEFAULT_CRITERIA,
        criteria_hash: hash,
        role_slots: [
          {
            role: 'Research Specialist',
            suggested_payout_yocto: (3n * YOCTO_PER_NEAR).toString(),
          },
          {
            role: 'Business Analyst',
            suggested_payout_yocto: (3n * YOCTO_PER_NEAR).toString(),
          },
          {
            role: 'Quality Auditor',
            suggested_payout_yocto: (2n * YOCTO_PER_NEAR).toString(),
          },
        ],
        deadline_ns: ((BigInt(Date.now()) + 72n * 3600n * 1000n) * 1_000_000n).toString(),
        review_window_ns: (48n * 3600n * 1_000_000_000n).toString(),
        status: 'Open',
        budget_yocto: (10n * YOCTO_PER_NEAR).toString(),
        allocated_yocto: '0',
        transferred_yocto: '0',
        in_flight_yocto: '0',
        claimable_pool_yocto: '0',
        refunded_yocto: '0',
        max_agents: 3,
        selected_agents: [],
      },
    ]);

    setBids(buildDemoBids(1));

    setContributions([]);
    setSelectedJobId(1);
    setRecomputedHashMap({});
    uploadedBytesRef.current = {};
  }

  async function handleResetDemo() {
    await seedSimulationPreview();
    setStatusBanner({
      type: 'ok',
      text: '[SIMULATION] Demo state reset. Mission #1 is open for bids with a 10 NEAR funded budget.',
    });
    setActiveTab('dashboard');
  }

  async function handleConnectWallet() {
    if (connectedWallet) {
      disconnectNearWallet();
      setConnectedWallet(null);
      return;
    }
    const acct = await connectNearWallet();
    if (acct) {
      setConnectedWallet(acct);
      setStatusBanner({
        type: 'ok',
        text: `Connected NEAR Testnet wallet: ${acct}`,
      });
    }
  }

  async function handleCreateJob(e: React.FormEvent) {
    e.preventDefault();
    try {
      const depositYocto = parseNearToYocto(budgetNear);
      const computed = await sha256HexFromText(criteriaText);
      const roleSlots: RoleSlotInput[] = [
        {
          role: 'Research Specialist',
          suggested_payout_yocto: (3n * YOCTO_PER_NEAR).toString(),
        },
        {
          role: 'Business Analyst',
          suggested_payout_yocto: (3n * YOCTO_PER_NEAR).toString(),
        },
        {
          role: 'Quality Auditor',
          suggested_payout_yocto: (2n * YOCTO_PER_NEAR).toString(),
        },
      ];

      if (executionMode === 'LIVE_TESTNET') {
        const res = await signAndSendContractCall(
          'create_job',
          {
            title,
            description,
            criteria_text: criteriaText,
            criteria_hash: computed,
            deadline_ns: ((BigInt(Date.now()) + 72n * 3600n * 1000n) * 1_000_000n).toString(),
            max_agents: maxAgents,
            role_slots: roleSlots,
            review_window_ns: (48n * 3600n * 1_000_000_000n).toString(),
          },
          depositYocto.toString()
        );
        setRecentTxHashes((prev) => [{ label: 'create_job', txHash: res.txHash }, ...prev]);
        await loadLiveTestnetState();
        setStatusBanner({
          type: 'ok',
          text: `Mission created and funded (${budgetNear} NEAR) on NEAR Testnet · Tx ${res.txHash}`,
          txHash: res.txHash,
        });
        setActiveTab('marketplace');
        return;
      }

      const nextId = jobs.length + 1;
      const newJob: JobRecord = {
        id: nextId,
        creator: simSigner,
        title,
        description,
        criteria_text: criteriaText,
        criteria_hash: computed,
        role_slots: roleSlots,
        deadline_ns: ((BigInt(Date.now()) + 72n * 3600n * 1000n) * 1_000_000n).toString(),
        review_window_ns: (48n * 3600n * 1_000_000_000n).toString(),
        status: 'Open',
        budget_yocto: depositYocto.toString(),
        allocated_yocto: '0',
        transferred_yocto: '0',
        in_flight_yocto: '0',
        claimable_pool_yocto: '0',
        refunded_yocto: '0',
        max_agents: maxAgents,
        selected_agents: [],
      };
      setJobs([newJob, ...jobs]);
      setBids((prev) => [...buildDemoBids(nextId), ...prev]);
      setContributions((prev) => prev.filter((c) => c.job_id !== nextId));
      setSelectedJobId(nextId);
      setActiveTab('marketplace');
      setStatusBanner({
        type: 'ok',
        text: `[SIMULATION] Created Mission #${nextId} (${budgetNear} NEAR budget, SHA-256 ${computed.slice(0, 16)}…). Agents are bidding.`,
      });
    } catch (err) {
      setStatusBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to create mission',
      });
    }
  }

  async function handleSelectCrew() {
    if (!currentJob) return;
    try {
      const rYocto = parseNearToYocto(crewSharesNear['researchpro.agent.testnet'] || '3');
      const mYocto = parseNearToYocto(crewSharesNear['marketmind.agent.testnet'] || '3');
      const vYocto = parseNearToYocto(crewSharesNear['verifyai.agent.testnet'] || '2');
      const totalAllocated = rYocto + mYocto + vYocto;
      const budgetYocto = BigInt(currentJob.budget_yocto);

      if (totalAllocated > budgetYocto) {
        throw new Error(
          `Selected crew total (${formatYoctoToNear(
            totalAllocated.toString()
          )} NEAR) exceeds funded escrow (${formatYoctoToNear(currentJob.budget_yocto)} NEAR).`
        );
      }

      const selections: CrewSelectionInput[] = [
        {
          agent: 'researchpro.agent.testnet',
          role: 'Research Specialist',
          agreed_payout_yocto: rYocto.toString(),
        },
        {
          agent: 'marketmind.agent.testnet',
          role: 'Business Analyst',
          agreed_payout_yocto: mYocto.toString(),
        },
        {
          agent: 'verifyai.agent.testnet',
          role: 'Quality Auditor',
          agreed_payout_yocto: vYocto.toString(),
        },
      ];

      if (executionMode === 'LIVE_TESTNET') {
        const res = await signAndSendContractCall('select_crew', {
          job_id: currentJob.id,
          selections,
        });
        setRecentTxHashes((prev) => [{ label: 'select_crew', txHash: res.txHash }, ...prev]);
        await loadLiveTestnetState(currentJob.id);
        setStatusBanner({
          type: 'ok',
          text: `Crew selected on NEAR Testnet (${formatYoctoToNear(
            totalAllocated.toString()
          )} NEAR allocated) · Tx ${res.txHash}`,
          txHash: res.txHash,
        });
        setActiveTab('crew');
        return;
      }

      const demoContribs = await buildDemoContributions(
        currentJob.id,
        currentJob.criteria_text,
        crewSharesNear
      );
      setJobs((prev) =>
        prev.map((j) =>
          j.id === currentJob.id
            ? {
                ...j,
                status: 'InProgress',
                allocated_yocto: totalAllocated.toString(),
                selected_agents: selections.map((s) => s.agent),
              }
            : j
        )
      );
      setBids((prev) =>
        prev.map((b) =>
          b.job_id === currentJob.id && selections.some((s) => s.agent === b.agent)
            ? { ...b, status: 'Selected' }
            : b
        )
      );
      setContributions((prev) => [
        ...prev.filter((c) => c.job_id !== currentJob.id),
        ...demoContribs,
      ]);
      setInspectedAgent('researchpro.agent.testnet');
      setStatusBanner({
        type: 'ok',
        text: `[SIMULATION] Crew locked: 3 NEAR + 3 NEAR + 2 NEAR = 8 NEAR allocated (2 NEAR unallocated). All three agents submitted deliverables bound to the criteria hash.`,
      });
      setActiveTab('crew');
    } catch (err) {
      setStatusBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to select crew',
      });
    }
  }

  async function handleRecomputeSha256(contrib: ContributionRecord) {
    let rawText = contrib.artifact_bytes_text || SAMPLE_DELIVERABLE_CONTENT[contrib.agent] || '';
    if (!rawText && contrib.artifact_uri) {
      try {
        const resp = await fetch(`/${contrib.artifact_uri.replace(/^\/+/, '')}`);
        if (resp.ok) {
          rawText = await resp.text();
        }
      } catch {
        // Fallback if local sample file is not served over HTTP
      }
    }
    const uploadedBytes = uploadedBytesRef.current[contrib.agent];
    const bytes =
      uploadedBytes || new TextEncoder().encode(rawText.replace(/\r\n/g, '\n').trim());
    const computedSha256 = await sha256HexFromBytes(bytes);
    const matches = computedSha256 === contrib.artifact_sha256;
    setRecomputedHashMap((prev) => ({
      ...prev,
      [contrib.agent]: {
        computedSha256,
        matches,
        byteLength: bytes.byteLength,
      },
    }));
  }

  async function handleUploadDeliverableFile(agentId: string, file: File) {
    const { sha256, bytes } = await sha256HexFromFile(file);
    const fullText = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    uploadedBytesRef.current[agentId] = bytes;
    setContributions((prev) =>
      prev.map((c) =>
        c.job_id === selectedJobId && c.agent === agentId
          ? {
              ...c,
              artifact_uri: file.name,
              artifact_sha256: sha256,
              artifact_bytes_text: fullText,
            }
          : c
      )
    );
    setRecomputedHashMap((prev) => ({
      ...prev,
      [agentId]: {
        computedSha256: sha256,
        matches: true,
        byteLength: bytes.byteLength,
      },
    }));
  }

  function handleDownloadDeliverable(contrib: ContributionRecord) {
    const text = contrib.artifact_bytes_text || SAMPLE_DELIVERABLE_CONTENT[contrib.agent] || '';
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${contrib.agent}-deliverable-r1.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function handleTamperDeliverable(contrib: ContributionRecord) {
    const original = contrib.artifact_bytes_text || SAMPLE_DELIVERABLE_CONTENT[contrib.agent] || '{}';
    const tampered = original.replace('19.5', '19.9').replace('51.8', '68.4');
    delete uploadedBytesRef.current[contrib.agent];
    setContributions((prev) =>
      prev.map((c) =>
        c.job_id === selectedJobId && c.agent === contrib.agent
          ? { ...c, artifact_bytes_text: tampered === original ? `${original} ` : tampered }
          : c
      )
    );
    setRecomputedHashMap((prev) => {
      const next = { ...prev };
      delete next[contrib.agent];
      return next;
    });
    setStatusBanner({
      type: 'err',
      text: `[SIMULATION] One byte changed in ${contrib.agent}'s file. Run "Recompute SHA-256" to see the digest fail against the committed hash.`,
    });
  }

  function handleRestoreDeliverable(contrib: ContributionRecord) {
    const original = SAMPLE_DELIVERABLE_CONTENT[contrib.agent] || '';
    delete uploadedBytesRef.current[contrib.agent];
    setContributions((prev) =>
      prev.map((c) =>
        c.job_id === selectedJobId && c.agent === contrib.agent
          ? {
              ...c,
              artifact_uri:
                DEMO_CREW.find((crew) => crew.agent === contrib.agent)?.artifactUri ||
                c.artifact_uri,
              artifact_bytes_text: original,
            }
          : c
      )
    );
    setRecomputedHashMap((prev) => {
      const next = { ...prev };
      delete next[contrib.agent];
      return next;
    });
    setStatusBanner({
      type: 'ok',
      text: `[SIMULATION] Restored the original ${contrib.agent} file. Recompute SHA-256 to confirm the byte-level match.`,
    });
  }

  /**
   * Calls the contract's `approve_contribution` method for a single agent,
   * matching `pub fn approve_contribution(&mut self, job_id: u64, agent_id: AccountId, rating: Option<u8>)`
   * in `contract/src/lib.rs`.
   */
  async function handleApproveSingleContribution(agentId: string, rating = 5) {
    if (!currentJob) return;
    try {
      const target = currentContribs.find((c) => c.agent === agentId);
      if (executionMode === 'SIMULATION' && (!target || target.status === 'Paid')) {
        setStatusBanner({
          type: 'err',
          text: `[SIMULATION] ${agentId} has no pending contribution to approve.`,
        });
        return;
      }
      if (executionMode === 'LIVE_TESTNET') {
        const res = await signAndSendContractCall(
          'approve_contribution',
          {
            job_id: currentJob.id,
            agent_id: agentId,
            rating,
          },
          '0',
          '50000000000000'
        );
        setRecentTxHashes((prev) => [
          { label: `approve_contribution (${agentId})`, txHash: res.txHash },
          ...prev,
        ]);
        await loadLiveTestnetState(currentJob.id);
        setStatusBanner({
          type: 'ok',
          text: `Approved ${agentId} on NEAR Testnet · Tx ${res.txHash}`,
          txHash: res.txHash,
        });
        return;
      }

      const payout = BigInt(target?.agreed_payout_yocto || '0');
      setContributions((prev) =>
        prev.map((c) =>
          c.job_id === currentJob.id && c.agent === agentId
            ? { ...c, status: 'Paid', customer_rating: rating }
            : c
        )
      );
      setJobs((prev) =>
        prev.map((j) =>
          j.id === currentJob.id
            ? {
                ...j,
                transferred_yocto: (BigInt(j.transferred_yocto) + payout).toString(),
              }
            : j
        )
      );
      setStatusBanner({
        type: 'ok',
        text: `[SIMULATION] Approved ${agentId} (${formatYoctoToNear(payout.toString())} NEAR).`,
      });
    } catch (err) {
      setStatusBanner({
        type: 'err',
        text: err instanceof Error ? err.message : `Failed to approve ${agentId}`,
      });
    }
  }

  /**
   * Approves each submitted crew contribution sequentially via `approve_contribution`
   * and then claims the unallocated balance via `claim_remaining_refund`.
   */
  async function handleApproveAllAndClaimRefund() {
    if (!currentJob) return;
    try {
      const pendingContribs = currentContribs.filter(
        (c) => c.status === 'Submitted' || c.status === 'ApprovedClaimable'
      );
      if (pendingContribs.length === 0 && executionMode === 'SIMULATION') {
        setStatusBanner({
          type: 'err',
          text: '[SIMULATION] No pending crew contributions remain. Approve the crew first, then claim the unallocated refund.',
        });
        return;
      }
      if (executionMode === 'LIVE_TESTNET') {
        let lastHash = '';
        for (const c of pendingContribs) {
          const res = await signAndSendContractCall(
            'approve_contribution',
            {
              job_id: currentJob.id,
              agent_id: c.agent,
              rating: 5,
            },
            '0',
            '50000000000000'
          );
          lastHash = res.txHash;
          setRecentTxHashes((prev) => [
            { label: `approve_contribution (${c.agent})`, txHash: res.txHash },
            ...prev,
          ]);
        }
        const refundRes = await signAndSendContractCall(
          'claim_remaining_refund',
          { job_id: currentJob.id },
          '0',
          '50000000000000'
        );
        lastHash = refundRes.txHash;
        setRecentTxHashes((prev) => [
          { label: 'claim_remaining_refund', txHash: refundRes.txHash },
          ...prev,
        ]);
        await loadLiveTestnetState(currentJob.id);
        setStatusBanner({
          type: 'ok',
          text: `Approved crew payouts and returned unallocated balance on NEAR Testnet · Tx ${lastHash}`,
          txHash: lastHash,
        });
        setActiveTab('escrow');
        return;
      }

      const paidYocto = pendingContribs.reduce(
        (sum, c) => sum + BigInt(c.agreed_payout_yocto),
        0n
      );
      const refundYocto = BigInt(currentJob.budget_yocto) - BigInt(currentJob.allocated_yocto);
      setJobs((prev) =>
        prev.map((j) =>
          j.id === currentJob.id
            ? {
                ...j,
                status: 'Completed',
                transferred_yocto: (
                  BigInt(j.transferred_yocto) + paidYocto
                ).toString(),
                refunded_yocto: (BigInt(j.refunded_yocto) + refundYocto).toString(),
              }
            : j
        )
      );
      setContributions((prev) =>
        prev.map((c) =>
          c.job_id === currentJob.id && pendingContribs.some((p) => p.agent === c.agent)
            ? { ...c, status: 'Paid', customer_rating: 5 }
            : c
        )
      );
      setStatusBanner({
        type: 'ok',
        text: `[SIMULATION] Called approve_contribution for ${
          pendingContribs.length
        } agents (${formatYoctoToNear(paidYocto.toString())} NEAR) + claim_remaining_refund (${formatYoctoToNear(
          refundYocto.toString()
        )} NEAR). Escrow conservation holds.`,
      });
      setActiveTab('escrow');
    } catch (err) {
      setStatusBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to settle contributions',
      });
    }
  }

  const currentJob = jobs.find((j) => j.id === selectedJobId) || jobs[0];
  const currentBids = bids.filter((b) => b.job_id === currentJob?.id);
  const currentContribs = contributions.filter((c) => c.job_id === currentJob?.id);
  const activeContrib =
    currentContribs.find((c) => c.agent === inspectedAgent) || currentContribs[0];

  const totalSelectedNear =
    Number(crewSharesNear['researchpro.agent.testnet'] || 0) +
    Number(crewSharesNear['marketmind.agent.testnet'] || 0) +
    Number(crewSharesNear['verifyai.agent.testnet'] || 0);

  return (
    <div className="ss-shell" data-testid="swarmsettle-app">
      {/* Unmistakable Mode Banner */}
      <div
        data-testid="network-mode-banner"
        className={`ss-banner ${
          executionMode === 'LIVE_TESTNET' ? 'ss-banner-live' : 'ss-banner-sim'
        }`}
      >
        <span>
          {executionMode === 'LIVE_TESTNET'
            ? `LIVE NEAR TESTNET MODE — Contract: ${nearConfig.contractId} · RPC: ${nearConfig.nodeUrl}`
            : 'SIMULATION PREVIEW — NOT ON-CHAIN: Running local state model. Switch to Live Testnet Mode for real RPC & wallet signing.'}
        </span>
        <span className="font-mono">
          {executionMode === 'LIVE_TESTNET' ? 'NEAR Testnet (No live-money value)' : 'Simulation Preview'}
        </span>
      </div>

      <div className="ss-container">
        <header className="ss-header">
          <div>
            <h1 className="ss-brand-title">
              <span>SwarmSettle</span>
              <span
                className={`ss-badge ${
                  executionMode === 'LIVE_TESTNET' ? 'ss-badge-green' : 'ss-badge-amber'
                }`}
              >
                {executionMode === 'LIVE_TESTNET' ? 'NEAR Testnet' : 'Simulation Preview'}
              </span>
            </h1>
            <p className="ss-brand-sub">
              One funded mission · Specialist AI agents in defined roles · Rule-enforced escrow settlement on NEAR
            </p>
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            {executionMode === 'SIMULATION' && (
              <button
                type="button"
                data-testid="reset-demo-btn"
                onClick={handleResetDemo}
                className="ss-btn"
              >
                Reset Demo Data
              </button>
            )}
            <button
              type="button"
              data-testid="toggle-mode-btn"
              onClick={() =>
                setExecutionMode(executionMode === 'SIMULATION' ? 'LIVE_TESTNET' : 'SIMULATION')
              }
              className="ss-btn"
            >
              Switch to {executionMode === 'SIMULATION' ? 'Live Testnet Mode' : 'Simulation Preview'}
            </button>

            {executionMode === 'LIVE_TESTNET' ? (
              <button
                type="button"
                data-testid="connect-wallet-btn"
                onClick={handleConnectWallet}
                className="ss-btn ss-btn-primary"
              >
                {connectedWallet ? `Wallet: ${connectedWallet}` : 'Connect NEAR Testnet Wallet'}
              </button>
            ) : (
              <select
                aria-label="Simulated Signer"
                value={simSigner}
                onChange={(e) => setSimSigner(e.target.value)}
                className="ss-btn font-mono"
              >
                <option value="customer.testnet">Sim Signer: customer.testnet</option>
                <option value="researchpro.agent.testnet">Sim Signer: researchpro.agent.testnet</option>
                <option value="marketmind.agent.testnet">Sim Signer: marketmind.agent.testnet</option>
                <option value="verifyai.agent.testnet">Sim Signer: verifyai.agent.testnet</option>
              </select>
            )}
          </div>
        </header>

        {statusBanner && (
          <div
            data-testid="status-banner"
            style={{
              marginTop: '14px',
              padding: '12px 16px',
              borderRadius: '12px',
              fontSize: '12px',
              fontWeight: 600,
              background: statusBanner.type === 'ok' ? '#E8F3EC' : '#FFE4E6',
              color: statusBanner.type === 'ok' ? '#1B4332' : '#9F1239',
              border: `1px solid ${statusBanner.type === 'ok' ? '#A7F3D0' : '#FECDD3'}`,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            <span>{statusBanner.text}</span>
            {statusBanner.txHash && getTxExplorerUrl(statusBanner.txHash) && (
              <a
                href={getTxExplorerUrl(statusBanner.txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono"
                style={{ color: '#1B4332', textDecoration: 'underline' }}
              >
                View Transaction on NearBlocks →
              </a>
            )}
          </div>
        )}

        <nav className="ss-nav" aria-label="Mission Workflow">
          {(
            [
              ['dashboard', '1. Mission Overview'],
              ['create', '2. Create & Fund Mission'],
              ['marketplace', '3. Specialist Bids & Crew Selection'],
              ['crew', '4. Deliverables & SHA-256 Verification'],
              ['escrow', '5. Settlement & Operator Revenue'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              data-testid={`tab-${id}`}
              onClick={() => setActiveTab(id)}
              className={`ss-tab ${activeTab === id ? 'ss-tab-active' : ''}`}
            >
              {label}
            </button>
          ))}
        </nav>

        {/* TAB 1: DASHBOARD */}
        {activeTab === 'dashboard' && currentJob && (
          <section className="ss-card" data-testid="view-dashboard">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
              <div>
                <span className="ss-badge ss-badge-green font-mono">
                  MISSION #{currentJob.id} · STATUS: {currentJob.status.toUpperCase()}
                </span>
                <h2 style={{ fontSize: '20px', fontWeight: 800, margin: '10px 0 6px' }}>
                  {currentJob.title}
                </h2>
                <p style={{ fontSize: '13px', color: '#57534E', margin: 0 }}>
                  {currentJob.description}
                </p>
              </div>
              <button
                type="button"
                data-testid="goto-create-btn"
                onClick={() => setActiveTab('create')}
                className="ss-btn ss-btn-primary"
              >
                Configure &amp; Fund Mission →
              </button>
            </div>

            <div className="ss-kpi-row" style={{ marginTop: '20px' }}>
              <div className="ss-kpi-box">
                <div className="ss-kpi-label">Funded Escrow Budget</div>
                <div className="ss-kpi-val font-mono">
                  {formatYoctoToNear(currentJob.budget_yocto)} NEAR
                </div>
              </div>
              <div className="ss-kpi-box">
                <div className="ss-kpi-label">Agreed Crew Allocation</div>
                <div className="ss-kpi-val font-mono">
                  {formatYoctoToNear(currentJob.allocated_yocto)} NEAR
                </div>
              </div>
              <div className="ss-kpi-box">
                <div className="ss-kpi-label">Transferred Payouts</div>
                <div className="ss-kpi-val font-mono">
                  {formatYoctoToNear(currentJob.transferred_yocto)} NEAR
                </div>
              </div>
              <div className="ss-kpi-box">
                <div className="ss-kpi-label">Refunded Unallocated</div>
                <div className="ss-kpi-val font-mono">
                  {formatYoctoToNear(currentJob.refunded_yocto)} NEAR
                </div>
              </div>
            </div>

            <div className="ss-grid-3" style={{ marginTop: '16px' }}>
              <div className="ss-step-card">
                <div className="ss-step-num">1</div>
                <div>
                  <div className="ss-step-title">Committed criteria</div>
                  <p className="ss-step-text">
                    The customer funds the mission and commits the acceptance checklist plus its
                    SHA-256 digest. The contract recomputes the hash on-chain.
                  </p>
                </div>
              </div>
              <div className="ss-step-card">
                <div className="ss-step-num">2</div>
                <div>
                  <div className="ss-step-title">Role-scoped crew</div>
                  <p className="ss-step-text">
                    Specialist agents bid on defined roles. The customer locks the crew, and the
                    contract enforces sum(payouts) ≤ funded budget.
                  </p>
                </div>
              </div>
              <div className="ss-step-card">
                <div className="ss-step-num">3</div>
                <div>
                  <div className="ss-step-title">Promise-safe settlement</div>
                  <p className="ss-step-text">
                    Approval pays each agreed share. Unallocated funds are refunded, and an expired
                    review window lets the agent claim its payout.
                  </p>
                </div>
              </div>
            </div>

          </section>
        )}

        {/* TAB 2: CREATE & FUND MISSION */}
        {activeTab === 'create' && (
          <form onSubmit={handleCreateJob} className="ss-card" data-testid="view-create">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 800, margin: 0 }}>
                  Create &amp; Fund Customer Mission
                </h2>
                <p style={{ fontSize: '12px', color: '#57534E', margin: '4px 0 0' }}>
                  Define the task, lock acceptance criteria with a SHA-256 hash, and attach the NEAR deposit.
                </p>
              </div>
              <span className="ss-badge ss-badge-green font-mono">
                Contract Method: create_job
              </span>
            </div>

            <div style={{ marginTop: '16px', display: 'grid', gap: '14px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '6px' }}>
                  Mission Title
                </label>
                <input
                  type="text"
                  data-testid="input-mission-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="ss-input"
                />
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '6px' }}>
                  Mission Description
                </label>
                <textarea
                  rows={2}
                  data-testid="input-mission-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="ss-textarea"
                />
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '6px' }}>
                  Acceptance Criteria (criteria_text)
                </label>
                <textarea
                  rows={4}
                  data-testid="input-criteria-text"
                  value={criteriaText}
                  onChange={(e) => setCriteriaText(e.target.value)}
                  className="ss-textarea font-mono"
                />
              </div>

              <div
                data-testid="criteria-hash-box"
                style={{
                  padding: '12px 14px',
                  borderRadius: '10px',
                  background: '#E8F3EC',
                  border: '1px solid rgba(27, 67, 50, 0.25)',
                  fontSize: '12px',
                }}
              >
                <div style={{ fontWeight: 700, color: '#1B4332' }}>
                  Computed Acceptance Criteria SHA-256 (criteria_hash — Verified On-Chain by Contract):
                </div>
                <div className="font-mono" style={{ marginTop: '4px', wordBreak: 'break-all', color: '#18181B' }}>
                  {criteriaHash}
                </div>
              </div>

              <div className="ss-grid-2">
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '6px' }}>
                    Escrow Deposit Budget (NEAR)
                  </label>
                  <input
                    type="text"
                    data-testid="input-budget-near"
                    value={budgetNear}
                    onChange={(e) => setBudgetNear(e.target.value)}
                    className="ss-input font-mono"
                  />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '6px' }}>
                    Defined Role Slots (Max Agents: {maxAgents})
                  </label>
                  <div className="ss-input font-mono" style={{ background: '#F3EFEA' }}>
                    Research Specialist · Business Analyst · Quality Auditor
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="submit"
                  data-testid="submit-create-job-btn"
                  className="ss-btn ss-btn-primary"
                >
                  Sign &amp; Fund Mission ({budgetNear} NEAR)
                </button>
              </div>
            </div>
          </form>
        )}

        {/* TAB 3: SPECIALIST BIDS & CREW SELECTION */}
        {activeTab === 'marketplace' && currentJob && (
          <section className="ss-card" data-testid="view-marketplace">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 800, margin: 0 }}>
                  Specialist Agent Bids &amp; Crew Allocation (select_crew)
                </h2>
                <p style={{ fontSize: '12px', color: '#57534E', margin: '4px 0 0' }}>
                  Compare proposals and on-chain track records, then lock each specialist’s share within the {formatYoctoToNear(currentJob.budget_yocto)} NEAR funded budget.
                </p>
              </div>
              <div className="ss-badge ss-badge-green font-mono">
                Selected Crew Total: {totalSelectedNear} NEAR / {formatYoctoToNear(currentJob.budget_yocto)} NEAR Budget
              </div>
            </div>

            <div className="ss-grid-2" style={{ marginTop: '16px' }}>
              {currentBids.map((bid) => {
                const profile = profiles.find((p) => p.account_id === bid.agent);
                const stats = agentStats[bid.agent];
                const isExcluded = Boolean(bid.exclusion_reason);
                return (
                  <div
                    key={bid.agent}
                    data-testid={`bid-card-${bid.agent}`}
                    style={{
                      padding: '16px',
                      borderRadius: '14px',
                      border: `1px solid ${isExcluded ? '#E4DFD5' : '#1B4332'}`,
                      background: isExcluded ? '#F3EFEA' : '#FFFFFF',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 800, fontSize: '15px' }}>
                          {profile?.display_name || bid.agent}
                        </div>
                        <div className="font-mono" style={{ fontSize: '11px', color: '#1B4332' }}>
                          {bid.agent} · Role: {bid.role}
                        </div>
                      </div>
                      <span className={`ss-badge ${isExcluded ? 'ss-badge-stone' : 'ss-badge-green'}`}>
                        {isExcluded
                          ? 'Role Not In Mission'
                          : `Bid: ${formatYoctoToNear(bid.requested_payout_yocto)} NEAR`}
                      </span>
                    </div>

                    <p style={{ fontSize: '12px', color: '#57534E', margin: '10px 0' }}>
                      {bid.proposal}
                    </p>

                    {stats && (
                      <div className="font-mono" style={{ fontSize: '11px', color: '#57534E', marginBottom: '10px' }}>
                        On-Chain Track Record: {stats.jobs_completed} jobs completed ·{' '}
                        {stats.accepted_contributions} accepted ·{' '}
                        {formatYoctoToNear(stats.total_earned_yocto)} NEAR earned
                      </div>
                    )}

                    {isExcluded ? (
                      <div
                        style={{
                          padding: '8px 10px',
                          borderRadius: '8px',
                          background: '#FEF3C7',
                          color: '#92400E',
                          fontSize: '11px',
                          fontWeight: 600,
                        }}
                      >
                        {bid.exclusion_reason}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                        <label style={{ fontSize: '12px', fontWeight: 700 }}>
                          Agreed Payout (NEAR):
                        </label>
                        <input
                          type="text"
                          data-testid={`share-input-${bid.agent}`}
                          value={crewSharesNear[bid.agent] || ''}
                          onChange={(e) =>
                            setCrewSharesNear((prev) => ({ ...prev, [bid.agent]: e.target.value }))
                          }
                          className="ss-input font-mono"
                          style={{ width: '110px', padding: '6px 10px' }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: '18px', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                data-testid="lock-crew-btn"
                onClick={handleSelectCrew}
                className="ss-btn ss-btn-primary"
              >
                Call select_crew ({totalSelectedNear} NEAR Allocated)
              </button>
            </div>
          </section>
        )}

        {/* TAB 4: DELIVERABLES, SHA-256 RECOMPUTATION & ADVISORY VERIFIER */}
        {activeTab === 'crew' && currentJob && (
          <section className="ss-card" data-testid="view-crew">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 800, margin: 0 }}>
                  Submitted Deliverables, Byte-Level SHA-256 Integrity &amp; Advisory Verification
                </h2>
                <p style={{ fontSize: '12px', color: '#57534E', margin: '4px 0 0' }}>
                  Approve individual contributions via <code>approve_contribution</code> or approve all and claim remaining unallocated funds via <code>claim_remaining_refund</code>.
                </p>
              </div>
              <button
                type="button"
                data-testid="approve-all-btn"
                onClick={handleApproveAllAndClaimRefund}
                className="ss-btn ss-btn-primary"
              >
                Approve All Crew Contributions &amp; Claim Remaining Refund
              </button>
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '16px', flexWrap: 'wrap' }}>
              {currentContribs.map((c) => (
                <button
                  key={c.agent}
                  type="button"
                  data-testid={`select-deliverable-${c.agent}`}
                  onClick={() => setInspectedAgent(c.agent)}
                  className={`ss-tab ${
                    activeContrib?.agent === c.agent ? 'ss-tab-active' : ''
                  }`}
                >
                  {c.role}: {c.agent} ({formatYoctoToNear(c.agreed_payout_yocto)} NEAR · {c.status})
                </button>
              ))}
            </div>

            {currentContribs.length === 0 && (
              <div
                data-testid="deliverables-empty-state"
                style={{
                  marginTop: '18px',
                  padding: '28px',
                  borderRadius: '14px',
                  border: '1px dashed #C7BFB2',
                  background: '#FAF8F5',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontWeight: 800, fontSize: '15px' }}>
                  No deliverables submitted yet
                </div>
                <p style={{ fontSize: '13px', color: '#57534E', margin: '6px 0 14px' }}>
                  Select a crew on the Bids tab first. In Simulation Preview, the three specialist
                  agents immediately submit hash-bound deliverables once the crew is locked.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab('marketplace')}
                  className="ss-btn ss-btn-primary"
                >
                  Go to Bids &amp; Crew Selection →
                </button>
              </div>
            )}

            {activeContrib && (
              <div className="ss-grid-2" style={{ marginTop: '16px' }}>
                <div className="ss-kpi-box" style={{ background: '#FFFFFF' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="ss-badge ss-badge-green font-mono">
                      Deliverable File · {activeContrib.role}
                    </span>
                    <button
                      type="button"
                      data-testid={`approve-single-${activeContrib.agent}`}
                      onClick={() => handleApproveSingleContribution(activeContrib.agent, 5)}
                      className="ss-btn ss-btn-primary"
                    >
                      Approve {activeContrib.agent} ({formatYoctoToNear(activeContrib.agreed_payout_yocto)} NEAR)
                    </button>
                  </div>

                  <div className="font-mono" style={{ fontSize: '12px', marginTop: '10px', fontWeight: 700 }}>
                    URI: {activeContrib.artifact_uri}
                  </div>
                  <div className="font-mono" style={{ fontSize: '11px', color: '#57534E', marginTop: '4px', wordBreak: 'break-all' }}>
                    Committed File SHA-256: {activeContrib.artifact_sha256}
                  </div>

                  <pre
                    data-testid="deliverable-file-preview"
                    style={{
                      marginTop: '10px',
                      padding: '12px',
                      borderRadius: '10px',
                      background: '#FAF8F5',
                      border: '1px solid #E4DFD5',
                      fontSize: '11px',
                      maxHeight: '190px',
                      overflow: 'auto',
                    }}
                  >
                    {activeContrib.artifact_bytes_text || SAMPLE_DELIVERABLE_CONTENT[activeContrib.agent]}
                  </pre>

                  <div style={{ marginTop: '12px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      data-testid="recompute-sha256-btn"
                      onClick={() => handleRecomputeSha256(activeContrib)}
                      className="ss-btn ss-btn-primary"
                    >
                      Recompute SHA-256 from File Bytes
                    </button>
                    <label className="ss-btn" style={{ display: 'inline-block' }}>
                      Upload Deliverable File
                      <input
                        type="file"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleUploadDeliverableFile(activeContrib.agent, f);
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => handleDownloadDeliverable(activeContrib)}
                      className="ss-btn"
                    >
                      Download File
                    </button>
                    <button
                      type="button"
                      data-testid="tamper-file-btn"
                      onClick={() => handleTamperDeliverable(activeContrib)}
                      className="ss-btn"
                      style={{ color: '#9F1239', borderColor: '#FECDD3' }}
                    >
                      Simulate 1-Byte Tamper
                    </button>
                    <button
                      type="button"
                      data-testid="restore-file-btn"
                      onClick={() => handleRestoreDeliverable(activeContrib)}
                      className="ss-btn"
                    >
                      Restore Original
                    </button>
                  </div>

                  {recomputedHashMap[activeContrib.agent] && (
                    <div
                      data-testid="recomputed-hash-result"
                      style={{
                        marginTop: '12px',
                        padding: '10px 12px',
                        borderRadius: '10px',
                        background: recomputedHashMap[activeContrib.agent].matches ? '#E8F3EC' : '#FFE4E6',
                        border: '1px solid #1B4332',
                        fontSize: '11px',
                      }}
                    >
                      <div style={{ fontWeight: 800, color: '#1B4332' }}>
                        {recomputedHashMap[activeContrib.agent].matches
                          ? `BYTE-LEVEL SHA-256 INTEGRITY MATCH (${recomputedHashMap[activeContrib.agent].byteLength} bytes verified)`
                          : 'SHA-256 MISMATCH DETECTED'}
                      </div>
                      <div className="font-mono" style={{ marginTop: '4px', wordBreak: 'break-all' }}>
                        Recomputed: {recomputedHashMap[activeContrib.agent].computedSha256}
                      </div>
                    </div>
                  )}
                </div>

                <div className="ss-kpi-box" style={{ background: '#FFFFFF' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="ss-badge ss-badge-amber">
                      ADVISORY QUALITY SCORE — CUSTOMER APPROVES PAYOUTS
                    </span>
                    <span className="font-mono" style={{ fontSize: '14px', fontWeight: 800, color: '#1B4332' }}>
                      Score: {activeContrib.verifier_score ?? 'N/A'}/100 (Advisory)
                    </span>
                  </div>

                  <p style={{ fontSize: '12px', color: '#18181B', marginTop: '12px', lineHeight: 1.5 }}>
                    {activeContrib.verifier_summary}
                  </p>

                  <div
                    style={{
                      marginTop: '12px',
                      padding: '10px 12px',
                      borderRadius: '10px',
                      background: '#FAF8F5',
                      border: '1px solid #E4DFD5',
                      fontSize: '11px',
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>Cryptographic Binding (submit_verifier_score):</div>
                    <div className="font-mono" style={{ marginTop: '4px', wordBreak: 'break-all', color: '#57534E' }}>
                      Audited Criteria SHA-256: {activeContrib.verifier_audited_criteria_hash || currentJob.criteria_hash}
                    </div>
                    <div className="font-mono" style={{ marginTop: '4px', wordBreak: 'break-all', color: '#57534E' }}>
                      Audited File SHA-256: {activeContrib.verifier_audited_artifact_sha256 || activeContrib.artifact_sha256}
                    </div>
                    <div className="font-mono" style={{ marginTop: '4px', wordBreak: 'break-all', color: '#57534E' }}>
                      Verifier Report SHA-256: {activeContrib.verifier_report_sha256 || 'N/A'}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {/* TAB 5: ESCROW SETTLEMENT & OPERATOR ECONOMICS */}
        {activeTab === 'escrow' && currentJob && (
          <section className="ss-card" data-testid="view-escrow">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 800, margin: 0 }}>
                  Escrow Settlement, Explorer Links &amp; Operator Revenue
                </h2>
                <p style={{ fontSize: '12px', color: '#57534E', margin: '4px 0 0' }}>
                  Funded: {formatYoctoToNear(currentJob.budget_yocto)} NEAR · Transferred: {formatYoctoToNear(currentJob.transferred_yocto)} NEAR · Refunded: {formatYoctoToNear(currentJob.refunded_yocto)} NEAR
                </p>
              </div>
            </div>

            {executionMode === 'SIMULATION' && currentJob.status === 'Completed' && (
              <div
                data-testid="simulation-settlement-receipt"
                style={{
                  marginTop: '14px',
                  padding: '14px 16px',
                  borderRadius: '12px',
                  background: '#E8F3EC',
                  border: '1px solid rgba(27, 67, 50, 0.3)',
                }}
              >
                <div style={{ fontSize: '12px', fontWeight: 800, color: '#1B4332' }}>
                  Simulated contract calls (NOT ON-CHAIN) — state-machine receipts
                </div>
                <div className="font-mono" style={{ fontSize: '11px', color: '#1B4332', marginTop: '6px', lineHeight: 1.7 }}>
                  create_job → 10 NEAR funded · select_crew → 8 NEAR allocated ·
                  approve_contribution ×3 → 8 NEAR paid · claim_remaining_refund → 2 NEAR returned
                </div>
                <div style={{ fontSize: '11px', color: '#57534E', marginTop: '6px' }}>
                  Switch to Live Testnet Mode to sign these same methods with a NEAR wallet and
                  receive real NearBlocks transaction hashes.
                </div>
              </div>
            )}

            {recentTxHashes.length > 0 && (
              <div style={{ marginTop: '14px', padding: '12px', borderRadius: '10px', background: '#E8F3EC', border: '1px solid #1B4332' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#1B4332', marginBottom: '6px' }}>
                  Recorded Live Testnet Transactions:
                </div>
                {recentTxHashes.map((item, idx) => (
                  <div key={`${item.txHash}-${idx}`} className="font-mono" style={{ fontSize: '11px', marginTop: '4px' }}>
                    {item.label}:{' '}
                    <a
                      href={getTxExplorerUrl(item.txHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#1B4332', textDecoration: 'underline' }}
                    >
                      {item.txHash}
                    </a>
                  </div>
                ))}
              </div>
            )}

            <div className="ss-grid-3" style={{ marginTop: '16px' }}>
              {currentContribs.map((c) => {
                const profile = profiles.find((p) => p.account_id === c.agent);
                const stats = agentStats[c.agent];
                return (
                  <div
                    key={c.agent}
                    data-testid={`settlement-card-${c.agent}`}
                    className="ss-kpi-box"
                    style={{ background: '#FFFFFF' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong style={{ fontSize: '14px' }}>{profile?.display_name || c.agent}</strong>
                      <span className="ss-badge ss-badge-green font-mono">
                        {formatYoctoToNear(c.agreed_payout_yocto)} NEAR ({c.status})
                      </span>
                    </div>
                    <div className="font-mono" style={{ fontSize: '11px', color: '#1B4332', marginTop: '6px' }}>
                      Receiving Account:{' '}
                      <a
                        href={getAccountExplorerUrl(c.agent)}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: '#1B4332', textDecoration: 'underline' }}
                      >
                        {c.agent}
                      </a>
                    </div>
                    <div className="font-mono" style={{ fontSize: '11px', color: '#57534E', marginTop: '4px' }}>
                      Declared Operator Metadata: {profile?.declared_operator_account || 'N/A'}
                    </div>
                    {stats && (
                      <div className="font-mono" style={{ fontSize: '11px', color: '#18181B', marginTop: '8px' }}>
                        On-Chain Stats: {stats.jobs_completed} jobs completed ·{' '}
                        {formatYoctoToNear(stats.total_earned_yocto)} NEAR earned
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="ss-kpi-row" style={{ marginTop: '16px' }}>
              <div className="ss-kpi-box">
                <div className="ss-kpi-label">Escrow Funded</div>
                <div className="ss-kpi-val font-mono">
                  {formatYoctoToNear(currentJob.budget_yocto)} NEAR
                </div>
              </div>
              <div className="ss-kpi-box">
                <div className="ss-kpi-label">Paid to Agents</div>
                <div className="ss-kpi-val font-mono">
                  {formatYoctoToNear(currentJob.transferred_yocto)} NEAR
                </div>
              </div>
              <div className="ss-kpi-box">
                <div className="ss-kpi-label">Refunded to Customer</div>
                <div className="ss-kpi-val font-mono">
                  {formatYoctoToNear(currentJob.refunded_yocto)} NEAR
                </div>
              </div>
              <div className="ss-kpi-box ss-kpi-conservation">
                <div className="ss-kpi-label">Conservation Check</div>
                <div className="ss-kpi-val font-mono">
                  {BigInt(currentJob.transferred_yocto) +
                    BigInt(currentJob.refunded_yocto) +
                    BigInt(currentJob.claimable_pool_yocto) ===
                  BigInt(currentJob.budget_yocto)
                    ? '✓ Balanced'
                    : 'In Progress'}
                </div>
              </div>
            </div>

            <div
              data-testid="operator-economics-note"
              style={{
                marginTop: '16px',
                padding: '14px 16px',
                borderRadius: '12px',
                background: '#FAF8F5',
                border: '1px solid #E4DFD5',
                fontSize: '12px',
                lineHeight: 1.55,
              }}
            >
              <strong>Agent Operator Economics &amp; Ownership Boundary:</strong> Agents are software operated by people or teams. When an operator controls the receiving NEAR account, settled payouts become service revenue that can cover model and compute costs, with any remainder as profit. A profile’s declared operator account field is informational metadata and does not by itself prove cryptographic control of the receiving wallet. SwarmSettle is a NEAR Testnet prototype—Testnet NEAR has no live-money value.
            </div>
          </section>
        )}
        <footer className="ss-footer">
          <span>SwarmSettle · NEAR Testnet prototype · Testnet NEAR has no live-money value.</span>
          <span className="font-mono">24/24 contract invariant tests · ABI verified · production build</span>
        </footer>
      </div>
    </div>
  );
}
