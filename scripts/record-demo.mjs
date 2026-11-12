/**
 * SwarmSettle — 2-minute screen-recorded demo (scripts/record-demo.mjs)
 *
 * Records the real running Vite app with Chrome DevTools Protocol screencast,
 * injects a burned-in caption track and spotlight highlights, then encodes a
 * 1920x1080 / 30 fps MP4 with ffmpeg.
 *
 * Usage:
 *   1. cd app && npm run dev -- --host 127.0.0.1 --port 5173
 *   2. cd .. && npm run demo:record
 *   3. Output: demo/SwarmSettle_Demo_2min.mp4
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const APP_URL = process.env.DEMO_URL || 'http://127.0.0.1:5173';
const OUT_DIR = path.resolve('demo');
const FRAMES_DIR = path.join(OUT_DIR, 'frames');
const OUT_FILE = path.join(OUT_DIR, 'SwarmSettle_Demo_2min.mp4');
const TOTAL_SECONDS = 120;
const CAPTURE_FPS = Number(process.env.DEMO_FPS || 15);

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Chrome/Edge not found. Set CHROME_PATH to a Chromium executable.');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  if (fs.existsSync(FRAMES_DIR)) fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
  fs.mkdirSync(FRAMES_DIR, { recursive: true });

  const browser = await chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--hide-scrollbars', '--force-color-profile=srgb', '--font-render-hinting=none'],
  });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1.2,
    colorScheme: 'light',
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();

  console.log(`[record] loading ${APP_URL}`);
  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="view-dashboard"]', { timeout: 30000 });

  // Clean simulation state on every recording.
  await page.evaluate(() => {
    const reset = document.querySelector('[data-testid="reset-demo-btn"]');
    if (reset) reset.click();
  });
  await page.waitForSelector('[data-testid="view-dashboard"]');

  await installOverlays(page);

  const client = await context.newCDPSession(page);
  const frames = [];
  let frameIndex = 0;
  let stopCapture = false;

  // Fixed-rate capture loop: CDP screencast throttles on mostly-static pages,
  // which produces choppy video. Capturing the viewport at a fixed cadence
  // gives deterministic, smooth 1080p output for a UI walkthrough.
  const captureStartedAt = Date.now();
  const capturePromise = (async () => {
    while (!stopCapture) {
      const loopStartedAt = Date.now();
      try {
        const { data } = await client.send('Page.captureScreenshot', {
          format: 'jpeg',
          quality: 88,
          fromSurface: true,
          captureBeyondViewport: false,
        });
        const file = path.join(FRAMES_DIR, `frame_${String(frameIndex).padStart(5, '0')}.jpg`);
        frames.push({ file, ts: (Date.now() - captureStartedAt) / 1000 });
        frameIndex += 1;
        await fs.promises.writeFile(file, Buffer.from(data, 'base64'));
      } catch (error) {
        console.warn('[record] capture skipped:', error.message);
      }
      const elapsed = Date.now() - loopStartedAt;
      const delay = Math.max(0, 1000 / CAPTURE_FPS - elapsed);
      if (delay > 0) await sleep(delay);
    }
  })();

  const startedAt = Date.now();
  const at = async (seconds) => {
    const target = startedAt + seconds * 1000;
    const delay = target - Date.now();
    if (delay > 0) await sleep(delay);
  };

  const setCaption = async (text) => {
    await page.evaluate((value) => {
      const node = document.getElementById('ss-caption-text');
      if (node) node.textContent = value;
    }, text);
  };

  const spotlight = async (selector, { scroll = true, padding = 8 } = {}) => {
    await page.evaluate(
      ({ selector: sel, scroll: doScroll, padding: pad }) => {
        document.querySelectorAll('.ss-spotlight').forEach((el) => {
          el.classList.remove('ss-spotlight');
        });
        const el = document.querySelector(sel);
        if (!el) return false;
        el.style.setProperty('--ss-spot-pad', `${pad}px`);
        el.classList.add('ss-spotlight');
        if (doScroll) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return true;
      },
      { selector, scroll, padding }
    );
  };

  const move = async (selector, dx = 0, dy = 0) => {
    const box = await page.locator(selector).first().boundingBox();
    if (!box) return;
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, {
      steps: 18,
    });
  };

  const click = async (selector) => {
    await page.locator(selector).first().click();
  };

  // -------------------------------------------------------------------------
  // 0:00 — Intro title card
  // -------------------------------------------------------------------------
  await setCaption(
    'One funded mission. A temporary crew of specialist AI agents. Transparent settlement on NEAR.'
  );
  await at(4.2);
  await page.evaluate(() => {
    const card = document.getElementById('ss-title-card');
    if (card) card.style.opacity = '0';
  });
  await at(5.4);
  await page.evaluate(() => document.getElementById('ss-title-card')?.remove());

  // -------------------------------------------------------------------------
  // 0:07 — Mission overview
  // -------------------------------------------------------------------------
  await at(7.0);
  await move('[data-testid="view-dashboard"] .ss-kpi-row');
  await spotlight('[data-testid="view-dashboard"] .ss-kpi-row');
  await at(10.0);
  await setCaption(
    'The customer locks a 10 NEAR escrow budget and commits the acceptance criteria with a SHA-256 digest.'
  );
  await at(14.5);
  await spotlight('[data-testid="view-dashboard"] .ss-grid-3');
  await at(20.0);

  // -------------------------------------------------------------------------
  // 0:20 — Create & fund: criteria commitment + create_job
  // -------------------------------------------------------------------------
  await click('[data-testid="tab-create"]');
  await at(21.2);
  await spotlight('[data-testid="input-criteria-text"]');
  await setCaption(
    'The contract recomputes SHA-256(criteria_text) on-chain, so the goalposts cannot move after funding.'
  );
  await at(25.0);
  await spotlight('[data-testid="criteria-hash-box"]');
  await at(30.0);
  await move('[data-testid="submit-create-job-btn"]');
  await at(32.0);
  await click('[data-testid="submit-create-job-btn"]');
  await page.waitForSelector('[data-testid="view-marketplace"]');
  await at(36.0);

  // -------------------------------------------------------------------------
  // 0:36 — Bids, exclusion reason, select_crew
  // -------------------------------------------------------------------------
  await setCaption(
    'Specialist agents bid by role. The customer locks a crew only if total payouts stay inside the 10 NEAR budget.'
  );
  await spotlight('[data-testid="bid-card-researchpro.agent.testnet"]');
  await at(40.0);
  await move('[data-testid="bid-card-marketmind.agent.testnet"]');
  await spotlight('[data-testid="bid-card-marketmind.agent.testnet"]');
  await at(43.5);
  await move('[data-testid="bid-card-codesmith.agent.testnet"]');
  await spotlight('[data-testid="bid-card-codesmith.agent.testnet"]');
  await at(47.0);
  await spotlight('[data-testid="bid-card-verifyai.agent.testnet"]');
  await at(49.0);
  await move('[data-testid="lock-crew-btn"]');
  await click('[data-testid="lock-crew-btn"]');
  await page.waitForSelector('[data-testid="view-crew"]');
  await at(51.0);

  // -------------------------------------------------------------------------
  // 0:51 — Deliverables + SHA-256 match
  // -------------------------------------------------------------------------
  await setCaption(
    'Each deliverable is bound to a SHA-256 digest. The browser recomputes the hash from the actual file bytes.'
  );
  await move('[data-testid="recompute-sha256-btn"]');
  await at(53.0);
  await click('[data-testid="recompute-sha256-btn"]');
  await page.waitForSelector('[data-testid="recomputed-hash-result"]');
  await at(56.0);
  await spotlight('[data-testid="recomputed-hash-result"]');
  await at(64.0);

  // -------------------------------------------------------------------------
  // 1:04 — Tamper test: mismatch, restore, match
  // -------------------------------------------------------------------------
  await setCaption(
    'Change one byte and the digest fails. Restore the original file and byte-level integrity passes again.'
  );
  await move('[data-testid="tamper-file-btn"]');
  await click('[data-testid="tamper-file-btn"]');
  await page.waitForSelector('[data-testid="status-banner"]');
  await at(67.0);
  await click('[data-testid="recompute-sha256-btn"]');
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="recomputed-hash-result"]')
        ?.textContent?.includes('MISMATCH')
  );
  await at(69.0);
  await spotlight('[data-testid="recomputed-hash-result"]');
  await at(73.0);
  await click('[data-testid="restore-file-btn"]');
  await at(74.0);
  await click('[data-testid="recompute-sha256-btn"]');
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="recomputed-hash-result"]')
        ?.textContent?.includes('MATCH')
  );
  await at(76.0);
  await spotlight('[data-testid="recomputed-hash-result"]');
  await at(81.0);

  // -------------------------------------------------------------------------
  // 1:21 — Advisory verifier binding
  // -------------------------------------------------------------------------
  await setCaption(
    "VerifyAI's advisory score is bound to the exact criteria hash and artifact hash. The customer still approves payouts."
  );
  await click('[data-testid="select-deliverable-marketmind.agent.testnet"]');
  await at(83.5);
  await spotlight('[data-testid="deliverable-file-preview"]');
  await at(88.0);
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.ss-kpi-box')];
    const verifier = cards.find((card) =>
      card.textContent?.includes('ADVISORY QUALITY SCORE')
    );
    if (verifier) {
      document.querySelectorAll('.ss-spotlight').forEach((el) => el.classList.remove('ss-spotlight'));
      verifier.classList.add('ss-spotlight');
      verifier.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  });
  await at(94.0);

  // -------------------------------------------------------------------------
  // 1:34 — Approve all + refund: conservation
  // -------------------------------------------------------------------------
  await setCaption(
    'Approval pays each agreed share. The unallocated 2 NEAR returns to the customer. Conservation holds: 8 + 2 = 10.'
  );
  await move('[data-testid="approve-all-btn"]');
  await at(96.0);
  await click('[data-testid="approve-all-btn"]');
  await page.waitForSelector('[data-testid="view-escrow"]');
  await at(99.0);
  await spotlight('[data-testid="simulation-settlement-receipt"]');
  await at(105.0);
  await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('.ss-kpi-box')];
    const conservation = boxes.find((box) =>
      box.textContent?.includes('CONSERVATION CHECK')
    );
    if (conservation) {
      document.querySelectorAll('.ss-spotlight').forEach((el) => el.classList.remove('ss-spotlight'));
      conservation.classList.add('ss-spotlight');
      conservation.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  });
  await at(110.0);

  // -------------------------------------------------------------------------
  // 1:50 — End card
  // -------------------------------------------------------------------------
  await setCaption(
    'SwarmSettle — a NEAR Testnet prototype. 24/24 contract invariant tests. Testnet NEAR has no live-money value.'
  );
  await page.evaluate(() => {
    const end = document.createElement('div');
    end.id = 'ss-end-card';
    end.innerHTML = `
      <div style="font-size:13px;letter-spacing:.18em;text-transform:uppercase;color:#A7F3D0;font-weight:800;">
        SwarmSettle · Demo complete
      </div>
      <div style="font-size:58px;font-weight:900;letter-spacing:-.035em;margin-top:10px;line-height:1;">
        One task. A temporary AI crew.<br/>Transparent settlement on NEAR.
      </div>
      <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:28px;">
        <span style="padding:9px 14px;border-radius:999px;background:rgba(232,243,236,.14);border:1px solid rgba(167,243,208,.35);font-size:15px;font-weight:700;color:#E8F3EC;">Rust contract · SHA-256 on-chain</span>
        <span style="padding:9px 14px;border-radius:999px;background:rgba(232,243,236,.14);border:1px solid rgba(167,243,208,.35);font-size:15px;font-weight:700;color:#E8F3EC;">24 / 24 invariant tests</span>
        <span style="padding:9px 14px;border-radius:999px;background:rgba(232,243,236,.14);border:1px solid rgba(167,243,208,.35);font-size:15px;font-weight:700;color:#E8F3EC;">Escrow balanced 8 + 2 = 10 NEAR</span>
      </div>
      <div style="margin-top:26px;font-size:15px;color:#C7E5D5;">
        NEAR Testnet prototype · Testnet NEAR has no live-money value
      </div>
    `;
    end.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:2147483002',
      'display:flex',
      'flex-direction:column',
      'justify-content:center',
      'align-items:center',
      'text-align:center',
      'padding:60px 90px',
      'background:radial-gradient(900px 500px at 50% 20%, rgba(27,67,50,.98), rgba(9,24,17,.985))',
      'color:#fff',
      'opacity:0',
      'transition:opacity .8s ease',
      'font-family:Inter,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif',
    ].join(';');
    document.body.appendChild(end);
    requestAnimationFrame(() => {
      end.style.opacity = '1';
    });
  });
  await at(116.0);
  await page.evaluate(() => {
    const end = document.getElementById('ss-end-card');
    if (end) end.style.opacity = '0';
  });
  await at(118.0);
  await page.evaluate(() => {
    const fade = document.createElement('div');
    fade.style.cssText =
      'position:fixed;inset:0;background:#000;z-index:2147483003;opacity:0;transition:opacity .9s ease;';
    document.body.appendChild(fade);
    requestAnimationFrame(() => {
      fade.style.opacity = '1';
    });
  });
  await at(120.0);

  stopCapture = true;
  await capturePromise;
  await page.close();
  await context.close();
  await browser.close();

  if (frames.length === 0) {
    throw new Error('No screencast frames captured.');
  }

  console.log(`[record] captured ${frames.length} frames; encoding video...`);
  frames.sort((a, b) => a.ts - b.ts);

  const concatPath = path.join(OUT_DIR, 'frames.ffconcat');
  const lines = ['ffconcat version 1.0'];
  for (let i = 0; i < frames.length; i += 1) {
    const nextTs = i + 1 < frames.length ? frames[i + 1].ts : frames[i].ts + 0.04;
    const duration = Math.max(0.01, Math.min(1.0, nextTs - frames[i].ts));
    lines.push(`file '${frames[i].file.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`);
    lines.push(`duration ${duration.toFixed(6)}`);
  }
  lines.push(`file '${frames[frames.length - 1].file.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`);
  lines.push('duration 0.040000');
  fs.writeFileSync(concatPath, lines.join('\n'), 'utf8');

  const ffmpeg = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-v',
      'error',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concatPath,
      '-t',
      String(TOTAL_SECONDS),
      '-vf',
      'fps=30,scale=1920:1080:flags=lanczos,format=yuv420p',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '19',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      OUT_FILE,
    ],
    { stdio: 'inherit' }
  );
  if (ffmpeg.status !== 0) {
    throw new Error('ffmpeg failed to encode the demo video.');
  }

  console.log(`[record] wrote ${OUT_FILE}`);
  console.log(`[record] output duration: ${TOTAL_SECONDS}s @ 1920x1080 / 30 fps`);
}

async function installOverlays(page) {
  await page.addStyleTag({
    content: `
      .ss-spotlight {
        outline: 3px solid #D97706 !important;
        outline-offset: var(--ss-spot-pad, 8px) !important;
        border-radius: 14px !important;
        box-shadow: 0 0 0 9px rgba(217, 119, 6, 0.16), 0 0 42px rgba(217, 119, 6, 0.22) !important;
        animation: ss-spot-pulse 1.7s ease-in-out infinite !important;
        transition: outline-color .2s ease !important;
      }
      @keyframes ss-spot-pulse {
        0%, 100% { outline-color: rgba(217, 119, 6, 0.95); }
        50% { outline-color: rgba(217, 119, 6, 0.45); }
      }
      #ss-caption {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 2147483000;
        padding: 20px 48px 28px;
        background: linear-gradient(180deg, rgba(9,24,17,0) 0%, rgba(9,24,17,.86) 28%, rgba(9,24,17,.97) 100%);
        pointer-events: none;
        font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      #ss-caption-inner {
        max-width: 1330px;
        margin: 0 auto;
        text-align: center;
      }
      #ss-caption-kicker {
        font-size: 11px;
        letter-spacing: .18em;
        text-transform: uppercase;
        color: #A7F3D0;
        font-weight: 800;
        margin-bottom: 8px;
      }
      #ss-caption-text {
        color: #FFFFFF;
        font-size: 24px;
        line-height: 1.32;
        font-weight: 650;
        letter-spacing: -0.012em;
        text-shadow: 0 1px 12px rgba(0,0,0,.35);
      }
      #ss-progress {
        height: 3px;
        margin: 15px auto 0;
        max-width: 1330px;
        border-radius: 999px;
        background: rgba(255,255,255,.16);
        overflow: hidden;
      }
      #ss-progress-fill {
        height: 100%;
        width: 0%;
        background: linear-gradient(90deg, #6EE7B7, #A7F3D0);
        box-shadow: 0 0 10px rgba(110,231,183,.7);
      }
      #ss-title-card {
        position: fixed;
        inset: 0;
        z-index: 2147483001;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        text-align: center;
        padding: 70px 100px;
        background: radial-gradient(1100px 620px at 50% 18%, #1B4332 0%, #0B1F16 62%, #07130E 100%);
        color: #fff;
        opacity: 1;
        transition: opacity 1.1s ease;
        font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        overflow: hidden;
      }
      #ss-title-card::after {
        content: '';
        position: absolute;
        inset: -25%;
        background:
          radial-gradient(600px 300px at 22% 22%, rgba(110,231,183,.16), transparent 70%),
          radial-gradient(600px 300px at 82% 72%, rgba(217,119,6,.15), transparent 70%);
        animation: ss-drift 14s ease-in-out infinite alternate;
      }
      @keyframes ss-drift {
        from { transform: translate3d(-2%, -1%, 0) scale(1); }
        to { transform: translate3d(2%, 1%, 0) scale(1.06); }
      }
      #ss-title-card > * { position: relative; z-index: 1; }
      .ss-title-logo {
        font-size: 86px;
        font-weight: 900;
        letter-spacing: -.045em;
        line-height: 1;
        background: linear-gradient(92deg, #FFFFFF 10%, #A7F3D0 90%);
        -webkit-background-clip: text;
        background-clip: text;
        -webkit-text-fill-color: transparent;
      }
      .ss-title-tag {
        font-size: 26px;
        color: #D1FAE5;
        margin-top: 18px;
        font-weight: 550;
      }
      .ss-title-kicker {
        font-size: 12px;
        letter-spacing: .22em;
        text-transform: uppercase;
        color: #6EE7B7;
        font-weight: 800;
        margin-bottom: 18px;
      }
    `,
  });

  await page.evaluate((totalSeconds) => {
    const caption = document.createElement('div');
    caption.id = 'ss-caption';
    caption.innerHTML = `
      <div id="ss-caption-inner">
        <div id="ss-caption-kicker">SwarmSettle · Live walkthrough · Simulation preview (not on-chain)</div>
        <div id="ss-caption-text"></div>
        <div id="ss-progress"><div id="ss-progress-fill"></div></div>
      </div>
    `;
    document.body.appendChild(caption);

    const title = document.createElement('div');
    title.id = 'ss-title-card';
    title.innerHTML = `
      <div class="ss-title-kicker">NEAR Testnet · Multi-agent escrow</div>
      <div class="ss-title-logo">SwarmSettle</div>
      <div class="ss-title-tag">One task. A temporary AI crew.<br/>Transparent on-chain settlement.</div>
      <div style="margin-top:44px;display:flex;gap:10px;flex-wrap:wrap;justify-content:center;">
        <span style="padding:8px 14px;border:1px solid rgba(167,243,208,.35);border-radius:999px;font-size:14px;color:#D1FAE5;background:rgba(255,255,255,.05);">SHA-256 deliverable integrity</span>
        <span style="padding:8px 14px;border:1px solid rgba(167,243,208,.35);border-radius:999px;font-size:14px;color:#D1FAE5;background:rgba(255,255,255,.05);">Role-scoped agent payouts</span>
        <span style="padding:8px 14px;border:1px solid rgba(167,243,208,.35);border-radius:999px;font-size:14px;color:#D1FAE5;background:rgba(255,255,255,.05);">Conservation-safe escrow</span>
      </div>
    `;
    document.body.appendChild(title);

    const fill = document.getElementById('ss-progress-fill');
    const start = performance.now();
    const tick = () => {
      const pct = Math.min(100, ((performance.now() - start) / 1000 / totalSeconds) * 100);
      if (fill) fill.style.width = `${pct}%`;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, TOTAL_SECONDS);
}

main().catch((error) => {
  console.error('[record] failed:', error);
  process.exit(1);
});
