// collector/scripts/feed/schedule-guard.mjs
// 예약 실행 문지기(2026-11-14): GitHub cron은 예약 실행을 빼먹거나 몇 시간 늦게 돌린다. 실측(11-04~11-13 열흘): 기대 30회 중 20회 도착(약 33% 누락), 날마다 정확히 2회
//   (02:31~04:39Z에 한 번, 10:19~16:50Z에 한 번). 23:17Z(KST 08:17) 칸 시각에 온 실행은 없다. 11-14는 03:21Z 하나뿐이었다.
// 그래서 feed.yml에 정기 cron(:17) 1시간 50분 뒤 보조 cron(AUX_CRON — 01·05·10시 UTC, KST 10:07·14:07·19:07)을 둔다. 30분 뒤는 같은 부하 시간대라 함께 빠지기 쉬워 피했다.
//   보조 시각의 KST 시간대(11시 전·15시 전·그 뒤)는 대신하는 정기 칸과 같아 같은 돌림 칸(rotationSlot)을 읽는다 — 늦게 와서 칸이 어긋나는 것은 정기 실행과 같고, 밀린 출처 읽기(overdueFeeds)가 메운다.
// 문지기는 예약 실행(정기·보조 cron)과 대신 부르기(trigger=cron-worker, 다른 입력 없음)에서 도는 별도 job(feed.yml guard — 권한 contents·actions 읽기뿐)이다(손 실행은 늘 수집). 정기 실행에도 건다(허브 결정 2026-11-14 —
//   보조가 이미 받아 왔으면 늦게 온 정기 실행은 받기 이후를 건너뛴다). 판정 창은 같고, 비용 문턱은 보조에만 건다(정기 몫을 먼저 남긴다). skip=1이면 뒤 단계(받기·추출·발행·상태 커밋·캐시 저장)를 건너뛰어 몇십 초 만에 끝난다:
//  - 최근 WINDOW_HOURS(2시간 40분 = 1시간 50분 + 지연 여유 50분) 안에 시작해 피드를 발행한 '온전한 수집' 실행이 있다. 온전한 수집 = main 가지의 schedule·workflow_dispatch 실행 중
//    이름(run-name)이 'feed'(groups로 좁힌 손 실행은 'feed · 묶음 …', 추출 입력 손 실행은 'feed · 추출'이라 세지 않는다)이고 job의 '공개 저장소에 올리기(gh-pages)'(PUBLISH_STEP)가 success인 실행.
//    끝 단계가 빨강(핵심 출처 일시 실패 등)이어도 발행했으면 센다 — 장애 중인 기관을 곧바로 다시 두드리지 않고 같은 메일도 두 번 보내지 않는다(검토 lite 1회차 이견 — 법무 쪽, 일시 오류 재시도는 받기 안의 10초 뒤 한 번).
//    발행하지 못한 실행(조립·서명·올리기 실패)은 세지 않아 보조가 다시 수집한다(이때는 받기를 마친 기관을 1시간 50분 만에 다시 읽는다 — 드문 경우로 둔다).
//  - 먼저 만들어져 아직 돌거나 기다리는 온전한 실행이 있다.
//  - 비용 문턱(보조만): 이번 달 feed 실행 분 + 남은 날 × (정기 하루 몫 + 문지기 6분) + 보조 한 번이 무료 분의 90%를 넘는다. 정기 하루 몫 = 3 × 이번 달 수집 실행(5분 넘게 돈 실행) 평균 분(바닥 15분)
//    — 정기 실행 몫을 먼저 남기고 남는 분으로만 보조를 돌린다(무료 분 소진으로 Actions 전체가 서지 않게, 10%는 다른 워크플로·청구 올림 몫). 문턱에 걸리면 정기 실행만 남는다(하루 2회꼴).
//  - API가 실패하면 수집한다(fail open) — 요약에 '문지기 고장'을 남기고 문지기 job을 빨갛게 끝낸다(메일). 수집 job은 그대로 돈다. 이때 기관 요청은 예약 실행 기준 하루 최대 9회(손 실행 제외 — 9회 모두 실제로 읽을 수 있다)(출처마다 요청 간격·robots·cycleDays는 그대로).
//  - 새 토큰을 만들지 않는다 — GITHUB_TOKEN(문지기 job은 actions: read뿐)으로 api.github.com GET만 한다(시험이 호스트·메서드도 본다).
// 알고 둔 한계: 받기가 시간 제한에 잘려 일부만 읽고 발행한 실행도 센다(못 읽은 출처는 다음 차례까지 지난 판). 상태 커밋(feed-state)이 실패한 실행도 센다.
//   정기 실행이 늦게 와도 보조가 2시간 40분 안에 발행했으면 건너뛴다 — 반대로 정기가 2시간 40분 넘게 늦거나 문지기가 고장 나면 둘 다 수집한다 — 이때 같은 기관을 몇 분 간격으로 두 번 읽는다(돌림 칸이 같으면 대학·학과 게시판도). 막힌 출처를 쉬게 하는 일은 따로 다룬다(허브 결정 2026-11-14).
// 예약 실행 대신 부르기(2026-11-15 허브 결정 — 11-15에도 08:17 정기 3시간 27분 늦음·10:07 보조 안 옴·12:17 정기 30분 넘게 안 옴): Cloudflare Worker cron(collector/dispatch, :47)이
//   workflow_dispatch + trigger=cron-worker로 부른다. 문지기는 이 실행을 보조 예약 실행처럼 판정한다(guardKind 'worker' — 창·비용 문턱이 보조와 같고, 발행은 끝 단계 색과 상관없이 센다).
//   actions:write fine-grained PAT 하나를 Worker 비밀값에 둔다(이 저장소만 — 전에는 '새 토큰 금지'로 고르지 않았으나 허브가 결정을 바꿨다). trigger가 다른 값이거나 비거나 다른 입력과 함께면 손 실행이다.
// 실행: cd collector && GH_TOKEN=… REPO=owner/name RUN_ID=… GITHUB_EVENT_NAME=schedule SCHEDULE='7 1,5,10 * * *' node scripts/feed/schedule-guard.mjs
import {appendFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {FREE_MINUTES, usage} from './usage-report.mjs';

export const WINDOW_HOURS = 8 / 3;   // 2시간 40분
/** 예약 실행 대신 부르기 표지 — collector/dispatch/worker.mjs TRIGGER와 같아야 한다(시험이 본다) */
export const WORKER_TRIGGER = 'cron-worker';
/** 이 실행이 어떤 예약 실행인가 → 'regular'|'aux'|'worker'|null(손 실행 — 문지기 없이 수집). 표지와 함께 다른 입력(groups·추출)을 넣은 손 실행은 대신 부르기로 보지 않는다(검토 lite — '손 실행은 늘 수집한다') */
export function guardKind({event, schedule, trigger, others = ''}) {
  if (event === 'schedule') return schedule === AUX_CRON ? 'aux' : 'regular';
  if (event === 'workflow_dispatch' && trigger === WORKER_TRIGGER && !String(others ?? '').trim()) return 'worker';
  return null;
}
export const FULL_RUN_NAME = 'feed';
/** 대신 부르기 실행 이름(feed.yml run-name) — 온전한 수집으로 세고, 정기·보조 문지기가 '최근 26시간 대신 부르기 0건'을 셀 때 쓴다 */
export const WORKER_RUN_NAME = 'feed · 대신 부르기';
/** 표지만 넣고 손으로 부른 확인 실행(token_days 없음) — 온전한 수집으로는 세지만 대신 부르기 생존 신호로는 세지 않는다(검토 lite 2회차) */
export const WORKER_MANUAL_NAME = 'feed · 대신 부르기(손)';
export const FULL_RUN_NAMES = new Set([FULL_RUN_NAME, WORKER_RUN_NAME, WORKER_MANUAL_NAME]);
/** 대신 부르기 발행은 정기·보조 판정에서 이 창으로 본다 — 08:47 대신 부르기 뒤 정기가 3시간 넘게 늦게 와도 같은 칸을 다시 읽지 않게(11-15 08:17 정기는 3시간 27분 늦었다) */
export const WORKER_WINDOW_HOURS = 4.5;
/** 대신 부르기 감시가 저절로 켜지는 기준 — 최근 이 날 수 안에 대신 부르기 실행이 한 번이라도 있었다(저장소 변수 DISPATCH_WORKER=0이면 끔) */
export const WORKER_ACTIVE_DAYS = 14;
/** 대신 부르기 토큰 남은 날이 이 아래면 문지기 job을 빨갛게(메일) — 교체할 시간을 남긴다(교체하면 멈춘다) */
export const TOKEN_WARN_DAYS = 14;
/** 정기·보조 문지기가 대신 부르기 실행을 찾는 창(시간) — 하루 세 번이니 26시간 안에 한 번도 없으면 Worker·토큰이 죽은 것 */
export const WORKER_SILENT_HOURS = 26;
/** 보조 cron 식 — feed.yml과 같아야 한다(시험이 본다) */
export const AUX_CRON = '7 1,5,10 * * *';   // 11-16~12-01 꺼짐(feed.yml에서 뺌 — 무료 분 아끼기), 12-01에 되살린다
/** 문지기가 세는 발행 단계 이름 — feed.yml의 id: deploy 단계 이름과 같아야 한다(시험이 본다) */
export const PUBLISH_STEP = '공개 저장소에 올리기(gh-pages)';
/** 정기 실행 한 번 어림의 바닥(분) — 이번 달 실측 평균이 이보다 작아도 이만큼은 남긴다 */
export const REGULAR_RUN_FLOOR = 15;
const WAITING = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested']);

/**
 * 대신 부르기 끊김 판정(순수 함수): runs = 최근 14일 workflow_dispatch 실행. → {alarm: 문장|null, line: 요약 한 줄}
 * 최근 14일 안에 대신 부르기(WORKER_RUN_NAME — Worker만 붙이는 이름)가 없으면 감시를 켜지 않는다(배포 전·꺼 둔 때). 있으면 26시간 안에 생성된 것이 없을 때 알린다(취소된 실행은 세지 않는다).
 */
// expected(저장소 변수 DISPATCH_WORKER=1 — 2026-11-16 공개 저장소 이전): 이력이 없어도 켠다 — 새 저장소로 옮긴 뒤 Worker·토큰이 한 번도 안 돌면 '꺼짐'이 아니라 끊김으로 알린다
export function workerWatch(runs, now = new Date(), {expected = false} = {}) {
  // main 실행만 센다 — 다른 가지로 부른 '대신 부르기'(환경 막음으로 곧 실패)가 Worker cron이 멈춘 것을 가리지 않게(검토 lite 2026-11-15)
  const mine = (runs ?? []).filter(r => r?.display_title === WORKER_RUN_NAME && (r.head_branch ?? 'main') === 'main');
  if (!mine.length && expected) return {alarm: `[대신 부르기 끊김] 대신 부르기 실행이 최근 ${WORKER_ACTIVE_DAYS}일 0건인데 DISPATCH_WORKER=1 — Cloudflare Worker(jangmak-feed-dispatch) 대상 저장소·토큰을 본다`, line: '끊김(한 번도 안 옴)'};
  if (!mine.length) return {alarm: null, line: `꺼짐(최근 ${WORKER_ACTIVE_DAYS}일 대신 부르기 실행 없음 — 배포 전이거나 오래 끊김)`};
  const recent = mine.filter(r => r.conclusion !== 'cancelled' && Date.parse(r.created_at ?? '') >= now.getTime() - WORKER_SILENT_HOURS * 3600_000);
  if (recent.length) return {alarm: null, line: `켜짐 — ${WORKER_SILENT_HOURS}시간 안 ${recent.length}건`};
  const last = mine.map(r => r.created_at).sort().at(-1);
  return {alarm: `[대신 부르기 끊김] 대신 부르기 실행 생성이 ${WORKER_SILENT_HOURS}시간 동안 0건(마지막 ${last}) — Cloudflare Worker(jangmak-feed-dispatch) cron 기록과 토큰(만료·권한)을 본다`, line: '끊김'};
}

/** 이 실행이 피드를 발행했는가 — '공개 저장소에 올리기(gh-pages)' 단계가 success */
export function published(jobs) {
  return (jobs ?? []).some(j => (j?.steps ?? []).some(s => s?.name === PUBLISH_STEP && s.conclusion === 'success'));
}

/**
 * 판정(순수 함수): runs는 이 워크플로의 최근 실행(GitHub API workflow_runs), jobsOf(id)는 그 실행의 jobs.
 * → {skip, reason: 'running'|'recent'|null, by: 실행 id|null}
 */
/** strict(정기 실행): 끝 단계가 success인 발행만 센다 — 빨강(핵심 출처 실패 등)으로 끝난 발행 뒤에는 정기 실행이 원래대로 다시 받는다(검토 lite 2026-11-14 — 정기에 문지기를 걸며 재시도 기회를 줄이지 않게). */
export function decide({runs, jobsOf, self, now = new Date(), windowHours = WINDOW_HOURS, strict = false}) {
  const selfCreated = Date.parse(self?.created_at ?? '');
  const sinceFor = r => now.getTime() - (r.display_title === WORKER_RUN_NAME ? Math.max(windowHours, WORKER_WINDOW_HOURS) : windowHours) * 3600_000;
  const others = (runs ?? []).filter(r => r && String(r.id) !== String(self?.id) && FULL_RUN_NAMES.has(r.display_title)
    && (r.head_branch ?? 'main') === 'main' && ['schedule', 'workflow_dispatch'].includes(r.event ?? 'schedule'));
  // 먼저 만들어져 아직 돌거나 기다리는 온전한 실행 — 그 실행이 수집한다(둘이 같이 오면 먼저 온 쪽만 돈다)
  const busy = others.find(r => WAITING.has(r.status) && Number.isFinite(selfCreated) && Date.parse(r.created_at ?? '') < selfCreated);
  if (busy) return {skip: true, reason: 'running', by: busy.id};
  const recent = others
    .filter(r => r.status === 'completed' && (strict ? r.conclusion === 'success' : r.conclusion !== 'cancelled') && Date.parse(r.run_started_at ?? r.created_at ?? '') >= sinceFor(r))
    .sort((a, b) => Date.parse(b.run_started_at ?? b.created_at) - Date.parse(a.run_started_at ?? a.created_at))
    .find(r => published(jobsOf(r.id)));
  if (recent) return {skip: true, reason: 'recent', by: recent.id, conclusion: recent.conclusion};
  return {skip: false, reason: null, by: null};
}

/** 이번 달 수집 실행(5분 넘게 돈 완료 실행 — 문지기가 건너뛴 실행은 1분 안팎이라 빠진다)의 평균 분, 바닥 REGULAR_RUN_FLOOR */
export function runAverage(runs) {
  const mins = (runs ?? []).filter(r => r?.status === 'completed').map(r => (Date.parse(r.updated_at ?? '') - Date.parse(r.run_started_at ?? r.created_at ?? '')) / 60000).filter(m => Number.isFinite(m) && m > 5);
  return Math.max(REGULAR_RUN_FLOOR, mins.length ? mins.reduce((a, b) => a + b, 0) / mins.length : 0);
}

/** 보조 실행의 비용 문턱(순수 함수): 이번 달 쓴 분 + 남은 날 × (3 × 수집 한 번 평균) + 보조 한 번 평균이 무료 분의 90%를 넘으면 건너뛴다 → {over, budget} */
/** 문지기 job 몫(분/일) — 예약 실행 하루 9회(정기·보조·대신 부르기 각 3회) × 청구 올림 1분 */
export const GUARD_MINUTES_PER_DAY = 9;

/**
 * 남은 무료 분 바닥(회장 결정 11-16 '가능한 무료인 방법으로' — 결제 한도를 올리지 않는다): 이 저장소의 이번 달 모든 워크플로 실행 분(벽시계 — macOS 러너는 10배,
 * 청구는 job별 올림이라 1.1배로 어림)이 무료 분에서 MIN_FREE_LEFT분 안쪽으로 오면 예약 실행(정기·보조·대신 부르기)을 건너뛴다. 손 실행은 사람이 고른 것이라 그대로 돈다.
 * → {left, used} (used는 어림 분). 실행 목록을 못 읽으면 문지기 고장 경로(수집)로 간다.
 */
export const MIN_FREE_LEFT = 30;
export function freeLeft(runs, {now = new Date(), free = FREE_MINUTES} = {}) {
  const month = now.toISOString().slice(0, 7);
  let used = 0;
  for (const r of runs ?? []) {
    if (String(r?.run_started_at ?? r?.created_at ?? '').slice(0, 7) !== month) continue;
    if (r.status !== 'completed' && r.status !== 'in_progress') continue;
    const a = Date.parse(r.run_started_at ?? r.created_at ?? ''), b = r.status === 'completed' ? Date.parse(r.updated_at ?? '') : now.getTime();
    if (!(Number.isFinite(a) && Number.isFinite(b) && b > a)) continue;
    used += ((b - a) / 60000) * (/ios\.yml$/.test(r.path ?? '') ? 10 : 1);
  }
  used = Math.ceil(Math.round(used * 1.1 * 1000) / 1000);   // 부동소수 어림(200×1.1=220.00000000000003)이 1분을 더하지 않게
  return {left: free - used, used};
}

export function overBudget(minutesUsed, {now = new Date(), free = FREE_MINUTES, runMinutes = REGULAR_RUN_FLOOR} = {}) {
  if (!Number.isFinite(minutesUsed)) return {over: false, budget: null};
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const daysLeft = daysInMonth - (now.getUTCDate() - 1 + (now.getUTCHours() * 60 + now.getUTCMinutes()) / 1440);
  const budget = Math.round(minutesUsed + daysLeft * (3 * runMinutes + GUARD_MINUTES_PER_DAY) + runMinutes);
  return {over: budget > free * 0.9, budget};
}

async function main() {
  const {GH_TOKEN, REPO, RUN_ID, GITHUB_EVENT_NAME, GITHUB_OUTPUT, GITHUB_STEP_SUMMARY, SCHEDULE, TRIGGER, TOKEN_DAYS, OTHER_INPUTS, DISPATCH_WORKER} = process.env;
  let extra = () => '';
  const out = async (skip, md) => {
    console.log(md);
    if (GITHUB_OUTPUT) await appendFile(GITHUB_OUTPUT, `skip=${skip ? 1 : 0}\n`);
    if (GITHUB_STEP_SUMMARY) await appendFile(GITHUB_STEP_SUMMARY, `### 예약 실행 문지기\n\n${md}${extra()}\n`);
  };
  const which = guardKind({event: GITHUB_EVENT_NAME, schedule: SCHEDULE, trigger: TRIGGER, others: OTHER_INPUTS});
  if (!which) { await out(false, '손 실행 — 문지기 없이 수집한다'); return 0; }
  // 대신 부르기(worker)는 창 판정이 보조와 같다(비엄격). 비용 문턱은 보조에만 — 대신 부르기는 빠진 정기 몫을 메우므로 문턱으로 끄지 않는다(검토 lite)
  const aux = which !== 'regular', kind = {regular: '정기', aux: '보조', worker: '대신 부르기'}[which];
  // 알림(문지기 job 빨강 → 메일, 수집에는 영향 없음): 대신 부르기 토큰이 곧 만료되거나, 대신 부르기를 켰는데 26시간 동안 한 번도 오지 않았다(만료·권한·Worker 고장 — 검토 lite 막음)
  const alarms = [];
  const days = /^\d{1,4}$/.test(String(TOKEN_DAYS ?? '')) ? Number(TOKEN_DAYS) : null;
  if (which === 'worker' && days !== null && days <= TOKEN_WARN_DAYS) alarms.push(`[토큰 만료] 대신 부르기 토큰이 ${days}일 뒤 만료된다 — collector/dispatch/README.md대로 새 토큰을 넣으면 이 알림은 멈춘다`);
  // 만료일을 못 읽음(머리 없음·확인 실패) — 14일 경고가 꺼진 상태라 알리되 빨강은 아니다(만료 없는 토큰·classic 토큰일 수 있다 — 첫 배포 확인에서 숫자가 보여야 한다)
  if (which === 'worker' && String(TOKEN_DAYS ?? '') === 'unknown') console.log('::warning::[토큰 만료] 대신 부르기 토큰의 만료일을 읽지 못했다 — 만료 경고가 꺼져 있다(fine-grained 토큰·만료 설정을 확인)');
  // 알림은 API를 부르기 전에 찍는다 — 뒤에서 문지기가 고장 나도 만료 알림이 사라지지 않게
  for (const a of alarms) console.log(`::error::[문지기] ${a}`);
  const tokenLineRaw = which === 'worker' ? `\n\n토큰 남은 날: ${days ?? (String(TOKEN_DAYS ?? '') || '없음(손으로 부른 실행)')}` : '';
  extra = () => tokenLineRaw + (alarms.length ? `\n\n알림: ${alarms.join(' / ')}` : '');
  try {
    if (!GH_TOKEN || !/^[\w.-]+\/[\w.-]+$/.test(REPO ?? '') || (REPO ?? '').includes('..') || !/^\d+$/.test(RUN_ID ?? '')) throw Error('no_token_or_repo');
    // 일시 오류(5xx·연결)는 5초 뒤 한 번 다시 — 한 번의 API 흔들림으로 문지기 빨강 메일이 가지 않게
    const once = async path => {
      const r = await fetch(`https://api.github.com/repos/${REPO}${path}`, {headers: {authorization: `Bearer ${GH_TOKEN}`, accept: 'application/vnd.github+json', 'user-agent': 'JanghakMonitor-guard'}, redirect: 'error', signal: AbortSignal.timeout(15000)});
      if (!r.ok) throw Error('api_' + r.status);
      return r.json();
    };
    const api = async path => { try { return await once(path); } catch (e) { if (/^api_4/.test(e?.message ?? '')) throw e; await new Promise(res => setTimeout(res, 5000)); return once(path); } };
    const now = new Date();
    const self = await api(`/actions/runs/${RUN_ID}`);
    // 남은 무료 분 바닥 — 모든 예약 실행에 먼저 본다(정기 포함). 넘으면 건너뛰고 요약에 남긴다(과금도, 멈춤 없이 0이 되는 일도 없게)
    {
      const all = [];
      for (let page = 1; page <= 10; page++) {
        const j = await api(`/actions/runs?per_page=100&page=${page}&created=%3E%3D${now.toISOString().slice(0, 7)}-01`);
        all.push(...(j.workflow_runs ?? []));
        if ((j.workflow_runs ?? []).length < 100) break;
      }
      const f = freeLeft(all, {now});
      if (f.left < MIN_FREE_LEFT) {
        console.log(`::warning::남은 무료 Actions 분이 ${MIN_FREE_LEFT}분 아래(어림 ${f.left}분) — ${kind} 예약 실행을 건너뛴다(다음 달 1일에 무료 분이 다시 생긴다)`);
        await out(true, `건너뜀(${kind} 실행): 남은 무료 Actions 분 어림 ${f.left}분 < ${MIN_FREE_LEFT}분 — 이번 달 이 저장소 실행 어림 ${f.used}분 / 무료 ${FREE_MINUTES}분. 피드는 지난 판 그대로(웹·앱 '마지막 확인'은 실제 발행 시각)`);
        return 0;
      }
    }
    const since = new Date(now.getTime() - (WINDOW_HOURS + 6) * 3600_000).toISOString().slice(0, 19) + 'Z';   // 늦게 시작한 실행·대기 중인 실행까지 넉넉히
    // 대신 부르기 끊김 감시(정기 실행에서만 — 하루 최대 세 통): 최근 14일 안에 대신 부르기가 돌았으면 저절로 켜지고 DISPATCH_WORKER=0이면 끈다. 이 조회가 실패해도 창 판정은 그대로(경고만)
    let watchLine = '';
    extra = () => tokenLineRaw + watchLine + (alarms.length ? `\n\n알림: ${alarms.join(' / ')}` : '');
    if (which === 'regular') {
      if (DISPATCH_WORKER === '0') watchLine = '\n\n대신 부르기 감시: 꺼짐(저장소 변수 DISPATCH_WORKER=0)';
      else {
        try {
          const w = workerWatch((await api(`/actions/workflows/${self.workflow_id}/runs?per_page=100&branch=main&event=workflow_dispatch&created=%3E%3D${new Date(now.getTime() - WORKER_ACTIVE_DAYS * 86400_000).toISOString().slice(0, 10)}`)).workflow_runs ?? [], now, {expected: DISPATCH_WORKER === '1'});
          if (w.alarm) { alarms.push(w.alarm); console.log(`::error::[문지기] ${w.alarm}`); }
          watchLine = `\n\n대신 부르기 감시: ${w.line}`;
        } catch (e) {
          console.log(`::warning::[대신 부르기 끊김] 대신 부르기 실행을 확인하지 못했다(원인 ${String(e?.message ?? 'error').replace(/[^a-z0-9_]/gi, '')}) — 창 판정은 그대로 한다`);
          watchLine = '\n\n대신 부르기 감시: 확인 못 함';
        }
      }
    }
    if (which === 'aux') {
      const month = [];
      for (let page = 1; page <= 5; page++) {
        const j = await api(`/actions/workflows/${self.workflow_id}/runs?per_page=100&page=${page}&created=%3E%3D${now.toISOString().slice(0, 7)}-01`);
        month.push(...(j.workflow_runs ?? []));
        if ((j.workflow_runs ?? []).length < 100) break;
      }
      const u = usage(month, {now});
      const avg = runAverage(month);
      const b = overBudget(u.minutes, {now, runMinutes: avg});
      if (b.over) { console.log('::warning::보조 실행 꺼짐 — 비용 문턱(이번 달 Actions 분이 무료 분의 90%에 가깝다, 정기 실행만 돈다)'); await out(true, `건너뜀: 비용 문턱 — 보조 실행은 수집하지 않는다(정기 실행만 돈다)\n\n- 이번 달 ${u.minutes}분\n- 남은 날 정기 몫: 수집 한 번 평균 ${Math.round(avg)}분 × 하루 3회\n- 합 약 ${b.budget}분 > 무료 ${FREE_MINUTES}분의 90%`); return alarms.length ? 1 : 0; }
    }
    const runs = (await api(`/actions/workflows/${self.workflow_id}/runs?per_page=50&branch=main&created=%3E%3D${since}`)).workflow_runs ?? [];
    const jobs = new Map();
    for (const r of runs) if (r.status === 'completed' && r.conclusion !== 'cancelled' && FULL_RUN_NAMES.has(r.display_title) && String(r.id) !== String(RUN_ID) && Date.parse(r.run_started_at ?? r.created_at ?? '') >= now.getTime() - (r.display_title === WORKER_RUN_NAME ? WORKER_WINDOW_HOURS : WINDOW_HOURS) * 3600_000) jobs.set(r.id, (await api(`/actions/runs/${r.id}/jobs?per_page=10`)).jobs ?? []);
    const d = decide({runs, jobsOf: id => jobs.get(id) ?? [], self, now, strict: !aux});
    if (GITHUB_OUTPUT) await appendFile(GITHUB_OUTPUT, `kind=${which}\n`);
    console.log(`::notice::문지기 ${which} ${d.skip ? `skip ${d.reason} by=${d.by}` : 'collect'}`);
    if (d.skip) { await out(true, d.reason === 'running' ? `건너뜀(${kind} 실행): 먼저 온 실행 ${d.by}이 돌고 있다 — 그 실행이 발행하지 못하면 이번 창은 수집이 없다(다음 예약 실행이 받는다)` : `건너뜀(${kind} 실행): 2시간 40분 안에 피드를 발행한 실행 ${d.by}이 있다${d.conclusion && d.conclusion !== 'success' ? ` — 그 실행은 끝 단계가 ${d.conclusion}(핵심 출처 일시 실패일 수 있음), 다음 정기 실행까지 다시 받지 않는다` : ''}`); return alarms.length ? 1 : 0; }
    { await out(false, `수집(${kind} 실행): 2시간 40분 안에 피드를 발행한 실행이 없다`); return alarms.length ? 1 : 0; }
  } catch (e) {
    console.log(`::error::[문지기] 예약 실행 문지기 고장(${kind} 실행) — 실행 목록을 읽지 못해 이 예약 실행도 수집한다(이어지면 같은 기관을 예약 실행 기준 하루 최대 9회(손 실행 제외 — 9회 모두 실제로 읽을 수 있다) 읽는다 — 요청 간격·robots는 그대로)`);
    { await out(false, `문지기 고장(${kind} 실행): 실행 목록을 읽지 못함(원인 ${String(e?.message ?? 'error').replace(/[^a-z0-9_]/gi, '')}) — 수집은 정상 진행`); return 1; }   // 문지기 job을 빨갛게(메일) — 수집 job은 skip이 '1'이 아니라 그대로 돈다
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
