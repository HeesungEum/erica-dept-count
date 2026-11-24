# ERICA 교육전략 포털

Firebase 프로젝트 `erica-curriculum`의 `erica-edu-portal` 사이트 → https://erica-edu-portal.web.app

## 링크 추가·수정

1. `links.json`의 `groups[].items`에 항목을 추가합니다.
   ```json
   { "title": "페이지 이름", "desc": "한 줄 설명", "url": "https://...", "icon": "survey", "color": "green" }
   ```
   - `icon`: compass, tree, chip, route, survey, book, count, link (없으면 link)
   - `color`: blue, gold, green, violet
2. `portal` 폴더에서 배포합니다.
   ```bash
   firebase deploy --only hosting --project erica-curriculum
   ```

배포 직전에 `scripts/build-links.mjs`가 자동 실행되어 각 URL에 접속하고,
구글 로그인 코드(Firebase `GoogleAuthProvider`, Google Identity Services 등)가 있으면
카드에 **구글 로그인 필요** 태그를 붙입니다. 결과는 `public/links.json`에 저장됩니다.

- 자동 판별이 틀리면 항목에 `"login": true` 또는 `"login": false`를 적어 직접 지정합니다.
- 페이지에 접속하지 못하면 이전 배포 때의 판별 값을 유지합니다.
- 배포 없이 판별만 해 보려면: `node scripts/build-links.mjs`
