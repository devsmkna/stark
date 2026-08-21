// P01 — il processo claude resta vivo e conversa su più turni?
// Se SI: STARK tiene un processo per sessione (architettura "long-lived").
// Se NO: STARK deve rilanciare + --resume ad ogni messaggio (architettura "one-shot").
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';

const CAP = '/root/DevsMachna/stark/spike/captures/p01.jsonl';
const cap = createWriteStream(CAP);

const args = [
  '-p',
  '--input-format', 'stream-json',
  '--output-format', 'stream-json',
  '--verbose',
  '--model', 'claude-haiku-4-5-20251001',
  '--tools', '',                       // niente tool: probe puramente conversazionale

  '--no-session-persistence',
];

const child = spawn('claude', args, { cwd: '/root/DevsMachna/stark/spike/sandbox', stdio: ['pipe','pipe','pipe'] });

const seenTypes = new Map();
let buf = '';
let turn = 0;
const answers = [];
let stderr = '';

child.stderr.on('data', d => { stderr += d.toString(); });

function send(text) {
  const msg = { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } };
  child.stdin.write(JSON.stringify(msg) + '\n');
  console.log(`\n>>> TURNO ${turn + 1}: ${text}`);
}

child.stdout.on('data', chunk => {
  buf += chunk.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    cap.write(line + '\n');
    let ev; try { ev = JSON.parse(line); } catch { console.log('  [NON-JSON]', line.slice(0,120)); continue; }
    const key = ev.type + (ev.subtype ? ':' + ev.subtype : '');
    seenTypes.set(key, (seenTypes.get(key) || 0) + 1);

    if (ev.type === 'result') {
      turn++;
      const txt = (ev.result ?? '').toString().trim();
      answers.push(txt);
      console.log(`<<< RISULTATO TURNO ${turn}: ${JSON.stringify(txt.slice(0,200))}`);
      if (ev.total_cost_usd !== undefined) console.log(`    costo turno: $${ev.total_cost_usd}  |  session_id: ${ev.session_id}`);
      if (turn === 1) send('Che numero ti ho chiesto di ricordare? Rispondi solo con il numero.');
      else child.stdin.end();
    }
  }
});

child.on('close', code => {
  console.log('\n──────── VERDETTO P01 ────────');
  console.log('exit code:', code);
  console.log('turni completati:', turn);
  console.log('tipi di evento visti:', JSON.stringify(Object.fromEntries(seenTypes), null, 2));
  const ok = turn >= 2 && /42/.test(answers[1] || '');
  console.log(ok
    ? 'ESITO: SI — processo long-lived multi-turno CONFERMATO (il turno 2 ricorda il turno 1)'
    : 'ESITO: NO / PARZIALE — risposte: ' + JSON.stringify(answers));
  if (stderr.trim()) console.log('\nSTDERR:\n' + stderr.slice(0, 2000));
  console.log('raw capture:', CAP);
});

send('Ricorda il numero 42. Rispondi solo con OK.');
setTimeout(() => { console.log('TIMEOUT 240s - nessun evento? stderr:'); console.log(stderr.slice(0,3000)); child.kill('SIGKILL'); }, 240000);
