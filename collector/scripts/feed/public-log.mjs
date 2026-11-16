#!/usr/bin/env node
// 공개 모드 로그(2026-11-16 — 공고 수집을 공개 저장소 kevinsu92/scholarship-feed Actions로 옮기는 선행 조건 ①).
//
// 쓰는 법: feed.yml이 공개 저장소에서 돌 때만 job env LOG가 이 실행기를 가리킨다 →  $LOG node scripts/feed/fetch.mjs --only …
//   비공개 저장소에서는 LOG가 비어 명령이 그대로 돈다(이 파일을 거치지 않는다).
//
// 공개 저장소의 Actions 로그·실행 요약(GITHUB_STEP_SUMMARY)·주석(::warning::/::error::)은 누구나 본다. 수집기 출력에는 공고 제목·첨부 파일명·
// 받은 응답 일부·'기관 요청'·legal-checks 문구·담당자 연락처가 섞일 수 있다(fetch.mjs logDiag, read.mjs 첨부명·read_error, extract·build 경고, gate 사유,
// 자식 도구(pdftotext·tesseract) 경고, 잡히지 않은 오류의 메시지 — 목록은 collector/scripts/feed/README.md '공개 모드 로그' 절).
// 줄마다 가리는 방식은 빠뜨리는 곳이 생기므로, 여기서는 자식 프로세스의 stdout·stderr를 통째로 받아 비공개 파일에만 쓰고
// 공개 로그에는 시작·진행·끝 코드·출력 줄 수·경고/오류 줄 수(숫자)만 낸다(아래 PUBLIC_LINE).
// 실행 요약은 비공개 파일로 돌린다(GITHUB_STEP_SUMMARY를 바꿔 넘긴다). GITHUB_OUTPUT은 그대로 넘긴다(뒤 단계 조건 — 로그에 찍히지 않는다).
// 비공개 파일(PUBLIC_LOG_DIR, 기본 feed-work/private-logs)은 feed.yml 끝 단계가 비공개 상태 저장소(scholarship-feed-state)의 feed-logs 가지로 올린다.
import {spawn} from 'node:child_process';
import {createWriteStream, mkdirSync, readdirSync} from 'node:fs';
import {basename, join} from 'node:path';
import {fileURLToPath} from 'node:url';

// 공개 줄은 아래 틀뿐이다(2026-11-16 검토 lite 3회차 — 출처 id·차단 코드를 공개 기록으로 남기지 않는다. 어느 기관이 막았는지는 비공개 로그·텔레그램에만).
//   [공개 모드 로그] <이름> 시작 / 진행 — 출력 N줄 / 끝 — 코드 N · 출력 N줄 · 경고 N · 오류 N — 자세한 로그는 비공개 상태 저장소 feed-logs의 <파일>
//   ::warning::<이름> 경고 N줄 / ::error::<이름> 실패(코드 N) N줄
// 내기 직전에 줄마다 PUBLIC_LINE 틀과 메일·휴대폰 탐지(validate.mjs hasMailLeft·hasPhoneLeft·hasPhoneLoose — 피드 발행 전 검사와 같은 꼴)를 거친다. 걸리면 그 줄 대신 고정 오류를 내고 실패로 끝낸다.
export const PUBLIC_LINE = /^(?:\[공개 모드 로그\] [a-z0-9.-]+(?: [a-z]+)? (?:시작|진행 — 출력 \d+줄|끝 — 코드 (?:\d+|신호 [A-Z]+) · 출력 \d+줄 · 경고 \d+ · 오류 \d+(?: — 자세한 로그는 비공개 상태 저장소 feed-logs의 [0-9a-z.-]+\.log)?)|::(?:warning|error)::[a-z0-9.-]+(?: [a-z]+)? (?:경고 \d+줄|실패\(코드 (?:\d+|[A-Z]+)\) \d+줄|오류 줄 \d+줄))$/;
let detect = null;
export async function leakDetector() {
  if (detect) return detect;
  try {
    const v = await import('./validate.mjs');
    detect = l => v.hasMailLeft(l) || v.hasPhoneLeft(l) || v.hasPhoneLoose(l) || /@|＠/.test(l);
  } catch {   // 문지기 job처럼 validate.mjs가 없는 곳 — 느슨한 꼴로
    detect = l => /@|＠|0\d{1,2}\D{0,3}\d{3,4}\D{0,3}\d{4}/.test(l);
  }
  return detect;
}
/** 공개 로그로 내도 되는 줄인가 — 틀에 맞고 메일·전화 꼴이 없다 */
export async function safePublicLine(line) {
  return PUBLIC_LINE.test(line) && !(await leakDetector())(line);
}

const isWarn = l => /^::warning\b/.test(l) || /\bwarn(ing)?\b|경고/i.test(l);
const isErr = l => /^::error\b/.test(l) || /\berror\b|오류|실패/i.test(l);

/** 모은 줄로 공개 로그에 낼 몇 줄을 만든다 — 숫자뿐(시험이 이 함수를 직접 본다) */
export function publicLines({name, code, signal, lines, logPath}) {
  const warn = lines.filter(l => isWarn(l) && !isErr(l));
  const err = lines.filter(isErr);
  const out = [];
  const where = logPath ? ` — 자세한 로그는 비공개 상태 저장소 feed-logs의 ${basename(logPath)}` : '';
  out.push(`[공개 모드 로그] ${name} 끝 — 코드 ${signal ? `신호 ${signal}` : code} · 출력 ${lines.length}줄 · 경고 ${warn.length} · 오류 ${err.length}${where}`);
  if (warn.length) out.push(`::warning::${name} 경고 ${warn.length}줄`);
  if (err.length || code !== 0 || signal) out.push(code !== 0 || signal ? `::error::${name} 실패(코드 ${signal ?? code}) ${err.length}줄` : `::warning::${name} 오류 줄 ${err.length}줄`);
  return out;
}

/** 이름표: node scripts/feed/fetch.mjs … → fetch.mjs, node scripts/feed/publish.mjs carry … → publish.mjs carry */
export function labelOf(argv) {
  const script = argv.find(a => a.endsWith('.mjs'));
  if (!script) return basename(argv[0] ?? 'command');
  const after = argv[argv.indexOf(script) + 1];
  return basename(script) + (after && /^[a-z]+$/.test(after) ? ` ${after}` : '');
}

let seq = 0;
async function main(argv) {
  if (!argv.length) { console.error('쓰는 법: public-log.mjs <명령> [인자…]'); process.exit(2); }
  // 비공개 저장소(PUBLIC_LOG가 1이 아님)에서는 그대로 돌린다 — 잘못 붙여도 출력이 사라지지 않게
  if (process.env.PUBLIC_LOG !== '1') {
    const c = spawn(argv[0], argv.slice(1), {stdio: 'inherit'});
    c.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 1));
    c.on('error', () => process.exit(127));
    return;
  }
  const dir = process.env.PUBLIC_LOG_DIR || 'feed-work/private-logs';
  mkdirSync(dir, {recursive: true});
  seq = readdirSync(dir).filter(n => n.endsWith('.log')).length + 1;
  const name = labelOf(argv);
  const stem = `${String(seq).padStart(2, '0')}-${name.replace(/[^a-z0-9.-]+/gi, '-')}`;
  const logPath = join(dir, `${stem}.log`);
  const file = createWriteStream(logPath, {flags: 'a'});
  const env = {...process.env, GITHUB_STEP_SUMMARY: join(dir, `${stem}.summary.md`)};
  const lines = [];
  let carry = {out: '', err: ''};
  const take = (k, chunk) => {
    file.write(chunk);
    const s = carry[k] + chunk.toString('utf8');
    const parts = s.split(/\r?\n/);
    carry[k] = parts.pop();
    lines.push(...parts);
  };
  let leaked = false;
  const say = async l => {
    if (await safePublicLine(l)) process.stdout.write(l + '\n');
    else { leaked = true; process.stdout.write('::error::공개 모드 로그 검사에 걸린 줄을 내지 않았다 — 실행을 실패로 끝낸다\n'); }
  };
  await say(`[공개 모드 로그] ${name} 시작`);
  // 시간 제한에 잘려도 공개 로그가 비지 않게 60초마다 진행 줄(숫자만)
  const tick = setInterval(() => { say(`[공개 모드 로그] ${name} 진행 — 출력 ${lines.length}줄`); }, Number(process.env.PUBLIC_LOG_TICK_MS) || 60_000);
  const child = spawn(argv[0], argv.slice(1), {stdio: ['inherit', 'pipe', 'pipe'], env});
  child.stdout.on('data', c => take('out', c));
  child.stderr.on('data', c => take('err', c));
  // 시간 제한에 잘리면(SIGTERM) 자식에게 넘기고, 공개 로그 줄은 자식이 끝난 뒤 낸다
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => child.kill(sig));
  const [code, signal] = await new Promise(res => {
    child.on('error', () => res([127, null]));
    child.on('close', (c, s) => res([c ?? 1, s]));
  });
  for (const k of ['out', 'err']) if (carry[k]) lines.push(carry[k]);
  clearInterval(tick);
  await new Promise(r => file.end(r));
  for (const l of publicLines({name, code, signal, lines, logPath})) await say(l);
  process.exit(leaked ? 1 : signal ? 1 : code);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main(process.argv.slice(2));
