/**
 * SwarmSettle v3 — Multi-Agent Workforce Runner (agents/agent-runner.mjs)
 *
 * Remediates Audit Section 2 ("P0 — The claimed live agent runner is currently a simulation"):
 * - Strict separation between `--testnet` (LIVE_TESTNET) and `--simulation` (SIMULATION_ONLY).
 * - `--testnet` NEVER uses `SwarmSettleEngine`; it connects to NEAR Testnet RPC, requires real
 *   deployed contract + per-agent signing credentials + a real LLM API key, and fails closed
 *   immediately if any prerequisite is missing.
 * - `--simulation` is explicitly labeled `[SIMULATION — NOT ON-CHAIN]`, writes distinct
 *   deliverable files to `artifacts-store/` via `agents/artifact-store.mjs`, verifies them by
 *   reading them back and recomputing SHA-256, and passes the actual downloaded artifact text
 *   and `criteria_text` to `VerifyAI`.
 */

import assert from 'node:assert/strict';
import { AI_EMPLOYEE_PERSONAS } from './personas.mjs';
import { generateAgentCompletion } from './llm-provider.mjs';
import {
  saveAndVerifyArtifact,
  readAndVerifyArtifactByUri,
  computeSha256Bytes,
} from './artifact-store.mjs';
import { SwarmSettleEngine, ONE_NEAR } from '../scripts/test-contract-invariants.mjs';

function parseNearToYocto(nearStr) {
  const [whole, frac = ''] = String(nearStr).trim().split('.');
  return BigInt(whole) * ONE_NEAR + BigInt(frac.padEnd(24, '0'));
}

function formatNear(yocto) {
  const v = BigInt(yocto);
  const whole = v / ONE_NEAR;
  const frac = v % ONE_NEAR;
  if (frac === 0n) return `${whole} NEAR`;
  return `${whole}.${frac.toString().padStart(24, '0').replace(/0+$/, '')} NEAR`;
}

export async function runLiveTestnetWorkflow() {
  const contractId = process.env.NEAR_CONTRACT_ID;
  const rpcUrl = process.env.NEAR_RPC_URL || 'https://rpc.testnet.near.org';
  const hasLlmKey = Boolean(
    process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY
  );

  if (!contractId) {
    throw new Error(
      '[LIVE_TESTNET FAIL-CLOSED] Missing NEAR_CONTRACT_ID environment variable. Deploy the contract first with `bash scripts/deploy-testnet.sh`.'
    );
  }
  if (!hasLlmKey) {
    throw new Error(
      '[LIVE_TESTNET FAIL-CLOSED] Missing LLM API key (set GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY). Live mode refuses to fall back to simulation.'
    );
  }
  if (
    !process.env.RESEARCHPRO_PRIVATE_KEY ||
    !process.env.MARKETMIND_PRIVATE_KEY ||
    !process.env.VERIFYAI_PRIVATE_KEY
  ) {
    throw new Error(
      '[LIVE_TESTNET FAIL-CLOSED] Missing per-agent Testnet signing keys (RESEARCHPRO_PRIVATE_KEY, MARKETMIND_PRIVATE_KEY, VERIFYAI_PRIVATE_KEY).'
    );
  }

  // Verify the contract account actually exists on NEAR Testnet RPC
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'swarmsettle-live-check',
      method: 'query',
      params: {
        request_type: 'view_account',
        finality: 'final',
        account_id: contractId,
      },
    }),
  });
  const payload = await res.json();
  if (payload.error) {
    throw new Error(
      `[LIVE_TESTNET FAIL-CLOSED] Contract account "${contractId}" not found on ${rpcUrl}: ${JSON.stringify(payload.error)}`
    );
  }
  console.log(`[LIVE_TESTNET] Verified deployed contract ${contractId} on ${rpcUrl}.`);
}

export async function runSimulationSwarmWorkflow({
  missionTitle = 'I want to launch an online coffee business. Create a complete business launch strategy.',
  missionDescription = 'Develop a specialty DTC online coffee subscription launch strategy covering competitor research, unit economics & pricing, and independent quality verification.',
  criteriaText = '1. Identify 5 specialty coffee competitors with pricing and roast positioning.\n2. Build subscription unit-economics model (CAC, LTV, gross margin, break-even bags/month).\n3. Audit all claims and verify completeness against criteria 1 & 2.',
  budgetNear = '10',
} = {}) {
  console.log('================================================================================');
  console.log(' [SIMULATION — NOT ON-CHAIN] SWARMSETTLE MULTI-AGENT WORKFLOW');
  console.log('================================================================================');

  const engine = new SwarmSettleEngine();
  const timeline = [];
  const logStep = (actor, action, detail) => {
    const entry = {
      mode: 'SIMULATION_ONLY',
      time: new Date().toISOString().slice(11, 19),
      actor,
      action,
      detail,
    };
    timeline.push(entry);
    console.log(`[SIMULATION] [${entry.time}] [${actor}] ${action} — ${detail}`);
  };

  let ts = 1_000_000_000n;
  const activeCrewPersonas = AI_EMPLOYEE_PERSONAS.slice(0, 3);

  // 1. Register AI profiles
  for (const persona of activeCrewPersonas) {
    engine.setContext(persona.accountId, 0n, (ts += 10_000_000n));
    engine.register_agent_profile({
      display_name: persona.displayName,
      primary_role: persona.primaryRole,
      specialty_summary: persona.specialty,
      skills: persona.skills,
      endpoint_or_handle: `https://swarmsettle.org/agents/${persona.id}`,
      min_rate_yocto: parseNearToYocto(persona.minRateNear),
      declared_operator_account: persona.ownerAccount,
      available: true,
    });
    logStep(
      persona.displayName,
      'Registered Profile',
      `Agent Account: ${persona.accountId} (Declared Operator: ${persona.ownerAccount})`
    );
  }

  // 2. Customer creates & funds mission
  const criteriaHash = computeSha256Bytes(criteriaText);
  const budgetYocto = parseNearToYocto(budgetNear);
  engine.setContext('customer.testnet', budgetYocto, (ts += 50_000_000n));
  const job = engine.create_job({
    title: missionTitle,
    description: missionDescription,
    criteria_text: criteriaText,
    criteria_hash: criteriaHash,
    deadline_ns: ts + 72n * 3_600n * 1_000_000_000n,
    max_agents: 3,
    role_slots: [
      { role: 'Research Specialist', suggested_payout_yocto: parseNearToYocto('2.0') },
      { role: 'Business Analyst', suggested_payout_yocto: parseNearToYocto('3.0') },
      { role: 'Quality Auditor', suggested_payout_yocto: parseNearToYocto('1.5') },
    ],
  });
  logStep(
    'customer.testnet',
    `Created Job #${job.id}`,
    `Budget: ${formatNear(job.budget_yocto)} | Criteria SHA-256: ${criteriaHash.slice(0, 16)}...`
  );

  // 3. Agents generate bids
  const generatedBids = [];
  for (const persona of activeCrewPersonas) {
    const completion = await generateAgentCompletion({
      phase: 'BID',
      persona,
      systemPrompt: persona.systemPrompt,
      userPrompt: `TASK_PHASE: BID\nTITLE: ${missionTitle}\nDESCRIPTION: ${missionDescription}\nCRITERIA:\n${criteriaText}`,
      contextData: { missionTitle, criteriaText },
      requireLiveLlm: false,
    });
    const askYocto = parseNearToYocto(completion.data.requestedNear);

    engine.setContext(persona.accountId, 0n, (ts += 20_000_000n));
    const bid = engine.submit_bid({
      job_id: job.id,
      role: completion.data.role,
      requested_payout_yocto: askYocto,
      proposal: completion.data.proposal,
      estimated_hours: completion.data.estimatedHours || 8,
    });
    generatedBids.push({ persona, bid, provider: completion.provider });
    logStep(
      persona.displayName,
      `Submitted Bid (${formatNear(askYocto)})`,
      `[${completion.provider}] "${completion.data.proposal}"`
    );
  }

  // 4. Select crew and dynamically compute actual allocated & reserve amounts
  const selections = generatedBids.map(({ persona, bid }) => ({
    agent: persona.accountId,
    role: bid.role,
    agreed_payout_yocto: bid.requested_payout_yocto,
  }));
  engine.setContext('customer.testnet', 0n, (ts += 30_000_000n));
  const selectedJob = engine.select_crew({ job_id: job.id, selections });
  const allocatedBig = BigInt(selectedJob.allocated_yocto);
  const reserveBig = BigInt(selectedJob.budget_yocto) - allocatedBig;
  logStep(
    'customer.testnet',
    'Selected 3-Agent Crew',
    `Allocated: ${formatNear(allocatedBig)} | Unallocated Reserve: ${formatNear(reserveBig)}`
  );

  // 5. Each agent generates a distinct deliverable, saves to durable local store, reads back & verifies SHA-256
  const storedDeliverables = new Map();
  for (const { persona } of generatedBids) {
    const completion = await generateAgentCompletion({
      phase: 'DELIVERABLE',
      persona,
      systemPrompt: persona.systemPrompt,
      userPrompt: `TASK_PHASE: DELIVERABLE\nTITLE: ${missionTitle}\nCRITERIA:\n${criteriaText}`,
      contextData: { missionTitle, criteriaText },
      requireLiveLlm: false,
    });

    const saved = saveAndVerifyArtifact({
      jobId: job.id,
      agentId: persona.accountId,
      round: 1,
      kind: 'deliverable',
      content: completion.text,
    });
    storedDeliverables.set(persona.accountId, saved);

    engine.setContext(persona.accountId, 0n, (ts += 60_000_000n));
    engine.submit_contribution({
      job_id: job.id,
      artifact_uri: saved.uri,
      artifact_sha256: saved.sha256,
      evidence_notes: `Stored at ${saved.relativePath} (${saved.byteLength} bytes, verified SHA-256 match)`,
    });
    logStep(
      persona.displayName,
      'Stored & Verified Deliverable',
      `URI: ${saved.uri} | SHA-256: ${saved.sha256.slice(0, 16)}...`
    );
  }

  // Verify that the 3 agents produced 3 DISTINCT deliverables and 3 DISTINCT SHA-256 hashes!
  const hashes = Array.from(storedDeliverables.values()).map((d) => d.sha256);
  assert.equal(
    new Set(hashes).size,
    3,
    'Each agent must produce a distinct deliverable with a unique SHA-256 digest'
  );

  // 6. VerifyAI downloads the actual stored artifacts, verifies their SHA-256, and evaluates against criteria_text
  const verifierPersona = activeCrewPersonas[2];
  for (const targetPersona of activeCrewPersonas.slice(0, 2)) {
    const targetSaved = storedDeliverables.get(targetPersona.accountId);
    const retrieved = readAndVerifyArtifactByUri(targetSaved.uri, targetSaved.sha256);
    assert.ok(retrieved.matches, 'Retrieved artifact SHA-256 must match on-chain commitment');

    const verifyComp = await generateAgentCompletion({
      phase: 'VERIFY',
      persona: verifierPersona,
      systemPrompt: verifierPersona.systemPrompt,
      userPrompt:
        `TASK_PHASE: VERIFY\nTITLE: ${missionTitle}\n` +
        `CRITERIA_TEXT:\n${criteriaText}\n` +
        `TARGET_AGENT: ${targetPersona.accountId}\n` +
        `TARGET_ARTIFACT_SHA256: ${retrieved.actualSha256}\n` +
        `TARGET_DELIVERABLE_CONTENT:\n${retrieved.text}`,
      contextData: {
        missionTitle,
        criteriaText,
        targetAgentId: targetPersona.accountId,
        targetDeliverableText: retrieved.text,
      },
      requireLiveLlm: false,
    });

    const savedReport = saveAndVerifyArtifact({
      jobId: job.id,
      agentId: `${verifierPersona.id}-on-${targetPersona.id}`,
      round: 1,
      kind: 'verifier-report',
      content: verifyComp.text,
    });

    engine.setContext(verifierPersona.accountId, 0n, (ts += 30_000_000n));
    engine.submit_verifier_score({
      job_id: job.id,
      target_agent_id: targetPersona.accountId,
      audited_criteria_hash: criteriaHash,
      audited_artifact_sha256: retrieved.actualSha256,
      quality_score: verifyComp.data.qualityScore,
      verification_summary: verifyComp.data.summary,
      report_sha256: savedReport.sha256,
    });
    logStep(
      verifierPersona.displayName,
      `Audited ${targetPersona.displayName} (${verifyComp.data.qualityScore}/100)`,
      `Bound to Criteria ${criteriaHash.slice(0, 10)}... & Artifact ${retrieved.actualSha256.slice(0, 10)}...`
    );
  }

  // 7. Customer approves contributions within review window and settles simulated payouts
  for (const { persona, bid } of generatedBids) {
    engine.setContext('customer.testnet', 0n, (ts += 30_000_000n));
    engine.approve_contribution({
      job_id: job.id,
      agent_id: persona.accountId,
      rating: 5,
    });
    engine.on_payout_complete({
      job_id: job.id,
      agent_id: persona.accountId,
      amount_yocto: bid.requested_payout_yocto,
      was_timeout_claim: false,
      succeeded: true,
    });
    logStep(
      'Simulation Engine',
      `Simulated Payout to ${persona.displayName}`,
      `Credited ${formatNear(bid.requested_payout_yocto)} to ${persona.accountId} (Declared Operator: ${persona.ownerAccount})`
    );
  }

  // 8. Claim remaining refund
  engine.setContext('customer.testnet', 0n, (ts += 30_000_000n));
  const refundedYocto = engine.claim_remaining_refund({ job_id: job.id });
  logStep(
    'Simulation Engine',
    'Simulated Remaining Refund',
    `Returned ${formatNear(refundedYocto)} unallocated reserve to customer.testnet`
  );

  return { engine, jobId: job.id, timeline, storedDeliverables };
}

if (process.argv.includes('--testnet')) {
  runLiveTestnetWorkflow().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
} else if (process.argv.includes('--simulation') || process.argv.includes('--demo')) {
  runSimulationSwarmWorkflow().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
