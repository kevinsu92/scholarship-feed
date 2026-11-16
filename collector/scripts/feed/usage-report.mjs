// collector/scripts/feed/usage-report.mjs
// Actions 사용 분 보고(2026-11-14): 이번 실행이 지금까지 쓴 분과 이번 달(UTC) feed 실행의 누적·월말 어림을 실행 요약에 적는다.
// GitHub API(GITHUB_TOKEN, 저장소 읽기만)로 이 워크플로의 이번 달 실행 목록을 읽는다 — 분은 실행 시작~마지막 갱신 시각(러너 분과 거의 같다, 올림 없음).
// 실패해도 다음 단계를 막지 않는다. 피드·상태는 바꾸지 않는다.
// 실행: cd collector && GH_TOKEN=… REPO=owner/name RUN_ID=… node scripts/feed/usage-report.mjs
import {appendFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const FREE_MINUTES = Number(process.env.FEED_FREE_MINUTES) > 0 ? Number(process.env.FEED_FREE_MINUTES) : 2000;

/** 실행 목록(runs: {id, run_started_at, updated_at, status}) → 보고 */
export function usage(runs, {now = new Date(), runId = null} = {}) {
  const month = now.toISOString().slice(0, 7);
  const mins = r => {
    if (r.status !== 'completed' && r.status !== 'in_progress') return 0;   // 대기(queued·waiting)는 러너를 쓰지 않는다
    const a = Date.parse(r.run_started_at ?? r.created_at ?? ''), b = r.status === 'completed' ? Date.parse(r.updated_at ?? '') : now.getTime();
    return Number.isFinite(a) && Number.isFinite(b) && b > a ? (b - a) / 60000 : 0;
  };
  const these = runs.filter(r => String(r.run_started_at ?? r.created_at ?? '').startsWith(month));
  const total = these.reduce((s, r) => s + mins(r), 0);
  const day = now.getUTCDate() - 1 + (now.getUTCHours() * 60 + now.getUTCMinutes()) / 1440;
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const projected = day >= 3 ? total / day * daysInMonth : null;   // 달 초(3일 전)에는 어림을 내지 않는다 — 한두 번으로 크게 흔들린다
  const self = runId == null ? null : these.find(r => String(r.id) === String(runId));
  return {month, runs: these.length, minutes: Math.round(total), projected: projected == null ? null : Math.round(projected), thisRun: self ? Math.round(mins(self) * 10) / 10 : null};
}

export function summaryMarkdown(u) {
  const lines = ['### Actions 사용 분(이 워크플로)', ''];
  if (u.thisRun != null) lines.push(`- 이번 실행: 지금까지 ${u.thisRun}분`);
  lines.push(`- ${u.month}(UTC) 실행 ${u.runs}회 · ${u.minutes}분${u.projected != null ? ` · 이 속도면 월말 약 ${u.projected}분` : ' · 월말 어림 없음(달 초)'} (무료 분 기준 ${FREE_MINUTES}분 — 요금제·공개 여부에 따라 다름)`);
  if (u.projected != null && u.projected > FREE_MINUTES * 0.8) lines.push(`- ⚠️ 월말 어림이 무료 분의 80%(${FREE_MINUTES * 0.8}분)를 넘는다`);
  lines.push('', '벽시계 어림이다 — 청구는 job별 올림이라 다를 수 있고, 다른 워크플로·저장소 분은 들지 않는다. 기준은 GitHub 설정 > 청구 값.');
  return lines.join('\n') + '\n';
}

async function main() {
  const {GH_TOKEN, REPO, RUN_ID, GITHUB_STEP_SUMMARY} = process.env;
  const say = async md => { console.log(md); if (GITHUB_STEP_SUMMARY) await appendFile(GITHUB_STEP_SUMMARY, md); };
  try {
    if (!GH_TOKEN || !/^[\w.-]+\/[\w.-]+$/.test(REPO ?? '')) throw Error('no_token_or_repo');
    const now = new Date(), since = now.toISOString().slice(0, 7) + '-01';
    const runs = [];
    for (let page = 1; page <= 5; page++) {
      const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/feed.yml/runs?per_page=100&page=${page}&created=%3E%3D${since}`, {headers: {authorization: `Bearer ${GH_TOKEN}`, accept: 'application/vnd.github+json', 'user-agent': 'JanghakMonitor-usage'}, signal: AbortSignal.timeout(15000)});
      if (!r.ok) throw Error('api_' + r.status);
      const j = await r.json();
      runs.push(...(j.workflow_runs ?? []));
      if ((j.workflow_runs ?? []).length < 100) break;
    }
    const u = usage(runs, {now, runId: RUN_ID});
    await say(summaryMarkdown(u));
    if (u.projected != null && u.projected > FREE_MINUTES * 0.8) console.log(`::warning::Actions 월말 어림 ${u.projected}분 — 무료 ${FREE_MINUTES}분의 80%를 넘음`);
  } catch (e) {
    await say(`### Actions 사용 분\n\n사용 분을 세지 못함(${String(e?.message ?? 'error').replace(/[^a-z0-9_]/gi, '')})\n`);
    console.log('::warning::Actions 사용 분을 세지 못함');
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
