// 포털 링크 빌드 스크립트 (firebase deploy 직전에 자동 실행: firebase.json의 predeploy)
//
// links.json 을 읽어 각 URL 이 구글 로그인을 요구하는지 판별한 뒤 public/links.json 으로 출력합니다.
//  - 항목에 "login": true/false 를 직접 적으면 자동 판별 대신 그 값을 씁니다.
//  - 판별: 페이지 HTML과 같은 사이트의 JS 파일(+ Firebase Auth 등 외부 인증 SDK import 여부)을 받아
//          구글 로그인 코드(GoogleAuthProvider, signInWithPopup/Redirect + google.com, Google Identity Services 등)를 찾습니다.
//          접속 시 accounts.google.com 으로 바로 이동하는 경우도 로그인 필요로 봅니다.
//  - 페이지에 접속하지 못하면 이전 배포 결과(public/links.json)의 값을 그대로 유지합니다.
//
// 실행: node scripts/build-links.mjs   (portal 폴더에서)

import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

// 프록시 환경(HTTPS_PROXY)에서는 Node 내장 fetch 가 프록시를 쓰도록 다시 실행
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const r = spawnSync(process.execPath, ["--no-warnings", ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, NODE_USE_ENV_PROXY: "1" },
  });
  process.exit(r.status ?? 1);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "links.json");
const OUT = path.join(ROOT, "public", "links.json");

const MAX_FILES = 40;          // 사이트당 최대로 받아볼 파일 수
const TIMEOUT_MS = 15000;

// 구글 로그인 흔적
const STRONG = [
  /GoogleAuthProvider/,                         // Firebase Auth (구글 제공자)
  /accounts\.google\.com\/gsi\//,               // Google Identity Services
  /google\.accounts\.(id|oauth2)\./,
  /apis\.google\.com\/js\/platform\.js/,        // 구형 Google Sign-In
  /firebaseui/i,
];
const SIGN_IN = /signInWith(Popup|Redirect)/;
const GOOGLE_PROVIDER = /["']google\.com["']/;

async function get(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { redirect: "follow", signal: ctrl.signal, headers: { "user-agent": "erica-portal-link-checker" } });
    return { ok: res.ok, status: res.status, finalUrl: res.url, text: res.ok ? await res.text() : "" };
  } finally {
    clearTimeout(t);
  }
}

// HTML/JS 안에서 참조하는 스크립트 URL 추출
function scriptRefs(text, base) {
  const refs = new Set();
  const patterns = [
    /<script[^>]+src=["']([^"']+)["']/gi,
    /<link[^>]+rel=["']modulepreload["'][^>]+href=["']([^"']+)["']/gi,
    /(?:import|export)\s[^"';]*?from\s*["']([^"']+)["']/g,
    /import\s*\(\s*["']([^"']+)["']\s*\)/g,
    /import\s*["']([^"']+\.m?js)["']/g,
    /["'](\/(?:_next|assets|static|js)\/[^"']+\.m?js)["']/g,   // 번들러 청크
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      try { refs.add(new URL(m[1], base).href); } catch {}
    }
  }
  return [...refs];
}

async function detect(url) {
  const origin = new URL(url).origin;
  const first = await get(url);
  if (!first.ok) throw new Error(`HTTP ${first.status}`);
  if (/^https:\/\/accounts\.google\.com\//.test(first.finalUrl)) return { login: true, evidence: "accounts.google.com 으로 리디렉션" };

  const queue = [[url, first.text]];
  const seen = new Set([url]);
  let files = 0;
  let signIn = false, googleProvider = false, firebaseAuth = false;

  while (queue.length && files < MAX_FILES) {
    const [u, text] = queue.shift();
    files++;
    for (const re of STRONG) if (re.test(text)) return { login: true, evidence: `${re.source} (${u})` };
    if (SIGN_IN.test(text)) signIn = true;
    if (GOOGLE_PROVIDER.test(text)) googleProvider = true;
    if (signIn && googleProvider) return { login: true, evidence: `signInWith* + google.com (${u})` };

    for (const ref of scriptRefs(text, u)) {
      if (seen.has(ref)) continue;
      seen.add(ref);
      if (/firebase-auth|@firebase\/auth|firebase\/auth/.test(ref)) firebaseAuth = true;
      if (new URL(ref).origin !== origin) continue;        // 외부 라이브러리는 내용까지 받지 않음
      try {
        const r = await get(ref);
        if (r.ok) queue.push([ref, r.text]);
      } catch {}
    }
  }
  if (firebaseAuth && signIn) return { login: true, evidence: "Firebase Auth + signInWith*" };
  return { login: false, evidence: `구글 로그인 코드 없음 (파일 ${files}개 확인)` };
}

const src = JSON.parse(await readFile(SRC, "utf8"));
let prev = {};
try {
  const old = JSON.parse(await readFile(OUT, "utf8"));
  for (const g of old.groups) for (const it of g.items) prev[it.url] = it.login;
} catch {}

let failed = 0;
for (const g of src.groups) {
  for (const it of g.items) {
    if (typeof it.login === "boolean") {
      console.log(`  [수동 지정] ${it.login ? "로그인 필요" : "공개      "}  ${it.title}`);
      continue;
    }
    try {
      const r = await detect(it.url);
      it.login = r.login;
      console.log(`  [자동 판별] ${r.login ? "로그인 필요" : "공개      "}  ${it.title}  ← ${r.evidence}`);
    } catch (e) {
      failed++;
      it.login = prev[it.url] ?? false;
      console.warn(`  [접속 실패] ${it.login ? "로그인 필요" : "공개      "}  ${it.title}  ← ${e.cause?.message || e.message}; 이전 값 유지`);
    }
  }
}

delete src["_안내"];
src.generatedAt = new Date().toISOString();
await writeFile(OUT, JSON.stringify(src, null, 2) + "\n");
console.log(`public/links.json 생성 완료${failed ? ` (접속 실패 ${failed}건은 이전 값 유지)` : ""}`);
