const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const { chromium } = require(path.join(root, 'qa', 'node_modules', 'playwright'));

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const badge = ([label, tone]) => `<span class="badge ${tone}">${escapeHtml(label)}</span>`;

const agents = [
  { agentKey: 'manager', agentName: 'Spirit', agentRole: 'Manager', avatar: '/assets/agent-spirit.svg', branch: 'agent/manager', status: 'idle', staleness: { label: 'No heartbeat', ageMinutes: null }, currentTaskSummary: 'Live Agent Operations telemetry release completed.', latestHandoffSummary: 'Standalone page integrated and deployed.', blockerSummary: null, lastTestSummary: 'Telemetry and browser checks passed.', lastAgentCommit: 'e054938', managerReviewStatus: 'approved', productionStatus: 'deployed' },
  { agentKey: 'dashboard', agentName: 'Stuart', agentRole: 'Dashboard', avatar: '/assets/agent-stuart.svg', branch: 'agent/dashboard', status: 'working', staleness: { label: 'Live/Recent', ageMinutes: 4 }, currentTaskSummary: 'Refining the Agent Operations visual hierarchy.', latestHandoffSummary: 'Dashboard density review ready.', blockerSummary: null, lastTestSummary: 'Responsive checks passed.', lastAgentCommit: 'abcdef1', managerReviewStatus: 'pending', productionStatus: 'not-deployed' },
  { agentKey: 'website', agentName: 'Kevin', agentRole: 'Website', avatar: '/assets/agent-kevin.svg', branch: 'agent/website', status: 'idle', staleness: { label: 'Stale', ageMinutes: 31 }, currentTaskSummary: 'Awaiting assignment', latestHandoffSummary: 'No handoff reported', blockerSummary: null, lastTestSummary: 'No tests reported', lastAgentCommit: null, managerReviewStatus: 'not-reviewed', productionStatus: 'not-deployed' },
];

const state = {
  agents,
  recentHandoffs: [{ agentKey: 'manager', summary: 'Standalone page integrated and deployed.' }],
  activeBlockers: [],
  approvalsPending: 0,
  releaseAuthority: 'Manager Agent',
  daronStatus: 'DARON STATUS\n\nWhat is working:\n- All systems operational.\n\nWhat I need from you:\n- Nothing right now.',
  managerState: { releaseApproval: 'approved', deployStatus: 'ready', productionHealthSummary: 'Healthy', finalBlockerSummary: null },
  managerCommunication: {
    unreadCount: 1,
    newest: { id: 'message-1', subject: 'Release ready', messageBody: 'The visual refinement is ready for review.', category: 'Update', priority: 'Important', createdAt: '2026-09-10T20:00:00Z', readAt: null, acknowledgedAt: null, isActive: true, relatedCommit: null, relatedDeployId: null },
    history: [{ id: 'message-0', subject: 'Earlier update', messageBody: 'Prior release completed.', category: 'Update', priority: 'Normal', createdAt: '2026-09-10T18:00:00Z', readAt: '2026-09-10T18:05:00Z', acknowledgedAt: null, isActive: true, relatedCommit: null, relatedDeployId: null }],
  },
};

(async () => {
  const moduleUrl = pathToFileURL(path.join(root, 'dashboard-p1', 'agent-operations.mjs')).href;
  const { agentOperations } = await import(moduleUrl);
  const css = ['styles.css', 'refinement.css', 'polish.css']
    .map(file => fs.readFileSync(path.join(root, 'dashboard-p1', file), 'utf8'))
    .join('\n');
  const html = agentOperations(escapeHtml, badge, state);
  const output = path.join(os.tmpdir(), 'rea-agent-operations-density');
  fs.mkdirSync(output, { recursive: true });

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1512, height: 1000 } });
  try {
    await page.setContent(`<style>body{margin:0;background:#071120;color:#e8edf5}.main{max-width:none}.panel{border:1px solid #354157;border-radius:14px}.section-gap{margin-top:20px}.panel-head{display:flex;justify-content:space-between}.timeline{list-style:none;padding:0}.title-line{display:flex;justify-content:space-between}</style><style>${css}</style><main class="main">${html}</main>`);

    assert.equal(await page.locator('.agent-card').count(), 3);
    assert.equal(await page.locator('.agent-card .agent-avatar').count(), 3);
    assert.equal(await page.locator('.agent-card .agent-avatar-fallback:not([hidden])').count(), 0);
    assert(await page.locator('.agent-card .agent-avatar-fallback[hidden]').evaluateAll(items => items.every(item => getComputedStyle(item).display === 'none')));
    assert(await page.locator('.heartbeat-dot').evaluateAll(items => items.every(item => item.getBoundingClientRect().width <= 8 && item.getBoundingClientRect().height <= 8)));
    assert.equal(await page.locator('.agent-state, .agent-card-footer').count(), 0);
    assert.equal(await page.locator('.agent-detail-disclosure[open]').count(), 0);
    assert.equal(await page.locator('.manager-report-disclosure[open]').count(), 0);
    assert.equal(await page.locator('.communication-history-disclosure[open]').count(), 0);
    assert.equal(await page.locator('.manager-message-newest').count(), 1);
    assert.equal(await page.locator('.agent-operations-cards').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length), 3);
    assert(await page.locator('.agent-card').evaluateAll(cards => cards.every(card => card.getBoundingClientRect().height < 340)));
    assert(await page.locator('.agent-card').evaluateAll(cards => cards.every(card => {
      const avatar = card.querySelector('.agent-avatar').getBoundingClientRect();
      const status = card.querySelector('.agent-status-badge').getBoundingClientRect();
      return avatar.right <= status.left || status.right <= avatar.left || avatar.bottom <= status.top || status.bottom <= avatar.top;
    })));
    assert((await page.locator('.agent-operations-lower').boundingBox()).y < 620);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: path.join(output, 'desktop-1512.png'), fullPage: true });

    await page.setViewportSize({ width: 1100, height: 900 });
    assert.equal(await page.locator('.agent-operations-cards').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length), 2);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator('.agent-operations-cards').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length), 1);
    assert.equal(await page.locator('.agent-detail-disclosure[open]').count(), 0);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: path.join(output, 'mobile-390.png'), fullPage: true });

    console.log('PASS Agent Operations density: desktop 3-up, medium 2-up, mobile 1-up, collapsed details, no overlap or overflow');
  } finally {
    await page.close();
    await browser.close();
  }
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
