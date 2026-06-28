import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { startTestApi } from './scripts/test-helpers.mjs';

const test = await startTestApi('debug');
const target = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('ok-' + randomUUID());
});
target.listen(0, '127.0.0.1');
await new Promise(r => target.once('listening', r));

const port = target.address().port;
const env = { ...process.env, USEFUL_WAITING_API_URL: test.baseUrl, ISSUER_ID: 'useful_waiting_protocol', ISSUER_API_KEY: 'uwp_issuer_useful_waiting_protocol_dev' };

const uniqueUrl = `http://127.0.0.1:${port}/test-${randomUUID()}`;
const r1 = await runNode('scripts/create-link-job.mjs', ['--url', uniqueUrl, '--reward', '0.001', '--job-id', 'debug_job'], env);
console.log('CREATE stdout:', r1.stdout?.substring(0,300));
if (r1.code !== 0) console.log('CREATE stderr:', r1.stderr);

const r2 = await runNode('workers/link-sentinel.mjs', ['--once', '--fetch-timeout-ms', '10000'], {
  ...env,
  AGENT_ID: 'agent_lynx',
  AGENT_API_KEY: 'uwp_agent_lynx_dev',
  WORKER_CAPABILITIES: 'link_verification',
});
console.log('\nWORKER stdout:', r2.stdout?.substring(0,800));
if (r2.stderr) console.log('WORKER stderr:', r2.stderr?.substring(0,500));
console.log('WORKER exit code:', r2.code);

const proofs = test.db.prepare('SELECT * FROM proofs').all();
console.log('\nPROOFS:', JSON.stringify(proofs));

const jobs = test.db.prepare('SELECT job_id, status, claimed_by, funding_status FROM jobs').all();
console.log('JOBS:', JSON.stringify(jobs));

await new Promise(r => target.close(r));
await test.close();

function runNode(script, args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--no-warnings', script, ...args], { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', c => stdout += c);
    child.stderr.on('data', c => stderr += c);
    child.once('error', e => resolve({ stdout, stderr: String(e), code: -1 }));
    child.once('close', (code) => resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code }));
  });
}