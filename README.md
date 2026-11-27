# 쓱부엉 (Team Fortune Bot)

평일 아침 9시에 Teams 단체 대화방마다 12띠 운세 카드 한 장을 두고 가는 봇입니다. 운세는 재미용입니다.

- GitHub 저장소: `namonak/teams-fortune-bot`
- 운영 주소: `https://fortune-bot.namonak.dev`
- 구성: TypeScript, Microsoft Agents SDK, SQLite, Gemini API, Docker Compose (`teams-meal-bot`, `teams-raffle-bot`과 같은 구조)
- 이름 규칙: GitHub 저장소만 `teams-fortune-bot`이고, 컨테이너·DB·ZIP 파일은 `team-fortune-bot`을 사용합니다.

## 하는 일

- 정기 발송: 업무일(주말과 공휴일 제외) 한국 시간 09:00~09:59에 30초마다 확인해 대화방마다 카드를 한 번 보냅니다. 9시에 서버가 멈춰 있었어도 10시 전에 다시 켜지면 보냅니다.
- 같은 날 같은 내용: 운세는 날짜별로 한 번 만들어 DB에 저장하고, 모든 대화방과 멘션 재요청에 같은 저장본을 씁니다.
- 별점: 그날 일진(날의 간지)과 각 띠의 전통 관계 규칙으로 정합니다. 문장은 Gemini가 쓱부엉 말투로 씁니다.
- LLM 실패 대비: Gemini 호출이 실패하거나 응답 형식이 맞지 않으면 템플릿 문장으로 카드를 보냅니다. 카드는 빠지지 않습니다.
- 카드 구성: 머리글과 요일 문구, 생일 쪽지(해당하는 날만), 머리글 요약, 12띠 한 줄 운세, 띠를 누르면 펼쳐지는 상세 운세(회의운, 점심운, 칼퇴운, 행운 메뉴, 행운의 색), 쓱부엉 근황입니다.
- 생일 쪽지: 오늘이 생일인 사람과, 다음 업무일 전까지(주말·연휴) 생일인 사람을 미리 축하합니다. 이름과 생일은 LLM에 보내지 않습니다.

단체 대화방에서만 동작하며 개인 대화와 팀 채널은 지원하지 않습니다.

| 입력 | 동작 |
| --- | --- |
| 단체 대화방에 앱 추가 | 대화방을 발송 대상으로 저장하고 한 번 인사 |
| `@쓱부엉`, `@쓱부엉 오늘`, `@쓱부엉 오늘 운세` | 오늘 저장된 카드를 다시 표시. 아직 만들기 전이면 「오늘 쪽지는… 아직이에요… (쓱)」 |
| 그 밖의 입력(`@쓱부엉 도움말` 등) | 사용법 안내 |

멘션 재요청은 저장본만 쓰며 LLM을 새로 호출하지 않습니다.

## 로컬 개발

준비물: Node 24 이상, npm, bash, zip, unzip

```bash
npm ci
cp .env.example .env    # 쓱부엉 전용 앱 정보를 입력해 주세요
npm test
npm run typecheck
npm run build
node --env-file=.env --import tsx src/index.ts    # 소스로 실행
node --env-file=.env dist/index.js                # 빌드 결과로 실행
npm run card:preview -- 2026-11-27                # 템플릿 문장으로 dist/card-2026-11-27.json 생성(LLM 호출 없음)
```

- `npm start`는 `.env`를 읽지 않고 셸 환경 변수를 사용합니다.
- 인증 필수값(`MicrosoftAppId`, `MicrosoftAppPassword`, `MicrosoftAppTenantId`) 중 하나라도 없으면 서버가 시작되지 않습니다.
- 테스트 범위: 일진·띠 관계·별점, 업무일과 생일 대상, 템플릿 문장, LLM 응답 검증, 저장소, 카드 JSON, 발송 시각과 중복 방지, 서버 인증과 멘션 명령. 실제 Teams 화면 표시와 실제 Gemini 호출은 확인하지 않습니다.

## 환경 변수

| 환경 변수 | 값 |
| --- | --- |
| `MicrosoftAppId` | Azure 봇 ID (Developer Portal의 앱 ID가 아닙니다) |
| `MicrosoftAppPassword` | 봇 클라이언트 비밀값 |
| `MicrosoftAppTenantId` | Microsoft 365 테넌트 ID |
| `PUBLIC_BASE_URL` | `https://fortune-bot.namonak.dev`. 카드 아이콘 주소(`/assets/owl.png`)의 앞부분입니다. 이 값이 없으면 아이콘 주소가 도메인 없는 상대 주소가 되어 Teams에서 아이콘이 보이지 않습니다. Compose는 값이 없을 때 이 주소를 기본값으로 씁니다. |
| `DATABASE_PATH` | 로컬 `./data/team-fortune-bot.sqlite`, 컨테이너 `/data/team-fortune-bot.sqlite`. 폴더가 없으면 처음 실행할 때 만듭니다. |
| `PORT` | 컨테이너 내부 `3978` |
| `GEMINI_API_KEY` | Gemini API 키. 비우면 시작은 하되 템플릿 문장만 쓰고 기동 로그에 「GEMINI_API_KEY가 없어 템플릿 문장만 씁니다」를 남깁니다. |
| `GEMINI_MODEL` | 필요할 때만 지정. 기본값 `gemini-3.6-flash` |
| `GEMINI_REASONING_EFFORT` | 필요할 때만 지정. 기본값 `low` |
| `GEMINI_BASE_URL` | 필요할 때만 지정. 기본값 `https://generativelanguage.googleapis.com/v1beta/openai/` |
| `BIRTHDAYS` | 양력 생일 목록. `이름:MM-DD`를 쉼표로 이어 적습니다. 예: `홍길동:12-12,김철수:02-04` |

생일 정보

- 실제 팀원 이름과 생일은 서버의 `.env` 파일 `BIRTHDAYS`에만 적습니다. 코드, 테스트, 문서, 커밋에는 쓰지 않으며 예시는 홍길동, 김철수만 씁니다.
- `.env`는 Git과 Docker 이미지, Teams ZIP에서 제외됩니다. 출생연도는 적지 않습니다.
- 형식이 틀린 항목(콜론 없음, `13-40` 같은 없는 날짜, 빈 항목)은 무시하고 올바른 항목만 읽습니다. 2월 29일 생일은 평년에 2월 28일로 봅니다.
- 생일을 바꾸면 `docker compose up -d`로 컨테이너를 다시 만들어 반영합니다. 이미 만들어진 그날 운세는 바뀌지 않고 다음 날부터 적용됩니다.

## 공휴일 표

- 업무일 판정에 쓰는 공휴일 표(`src/holidays.ts`)에는 2026년과 2027년만 들어 있습니다.
- 매년 말에 다음 해 공휴일과 대체공휴일을 추가해야 합니다. 표에 없는 연도의 날짜를 판정하면 「공휴일 표에 YYYY년이 없습니다. src/holidays.ts를 갱신하세요」 경고 로그가 연도별로 한 번 남고, 그해는 주말만 쉬는 날로 보아 공휴일에도 카드를 보냅니다.

## 보안 검사

`.github/workflows/security.yml`이 main 푸시, PR, 수동 실행, 매일 02:50 KST에 실행됩니다.

- 의존성 검사: 테스트와 타입 검사 뒤 `npm audit --omit=dev --audit-level=moderate` 실행
- 이미지 검사: Docker 이미지를 빌드해 Trivy(컨테이너 이미지 취약점 검사 도구) v0.76.2로 수정 가능한 HIGH·CRITICAL 취약점 검사
- 차단 기준: 두 검사 중 하나라도 취약점을 찾으면 워크플로가 실패합니다.
- 버전 고정: 간접 의존성 `body-parser` 2.4.0, `proxy-addr` 2.0.8을 `package.json`의 `overrides`로 고정합니다.
- 운영 이미지: 실행에 쓰지 않는 npm과 npx를 삭제하고, root가 아닌 `node` 사용자로 실행합니다.

## 서버 배포

Azure 봇 등록과 비밀값 발급, DNS와 Caddy 설정, 서버 배포는 저장소 소유자가 진행합니다.

1. Azure Bot에 쓱부엉 전용 봇을 등록하고 Teams 채널을 연결합니다. 메시지 엔드포인트는 `https://fortune-bot.namonak.dev/api/messages`입니다. 다른 봇의 앱 ID와 비밀값은 재사용하지 않습니다.
2. DNS에 `fortune-bot.namonak.dev`를 서버 주소로 등록합니다.
3. 저장소를 내려받고 `.env`를 설정합니다.

   ```bash
   git clone https://github.com/namonak/teams-fortune-bot.git ~/workspace/teams-fortune-bot
   cd ~/workspace/teams-fortune-bot
   cp .env.example .env
   chmod 600 .env
   ```

4. Caddyfile에 아래 설정을 추가하고, `caddy validate`로 검사한 뒤 `caddy reload`로 재시작 없이 반영합니다. HTTPS 인증서는 Caddy가 자동으로 발급하고 갱신합니다.

   ```caddyfile
   fortune-bot.namonak.dev {
       reverse_proxy 127.0.0.1:3981
   }
   ```

5. `docker compose up -d --build`로 실행합니다. 구형 환경에서는 `docker-compose`를 사용합니다.
6. `curl https://fortune-bot.namonak.dev/healthz`가 `{"ok":true}`를 반환하는지 확인합니다. `https://fortune-bot.namonak.dev/assets/owl.png`가 열리면 카드 아이콘도 보입니다.

운영 기준

- 호스트 포트: 3981 (식사 봇 3978, 투표곰 3979, 쿠웨이트박 3980과 겹치지 않음)
- 시간대: 발송 시각은 서버 시간대와 관계없이 한국 시간으로 계산합니다.
- 자동 실행: Compose의 `restart: unless-stopped`로 서버를 재부팅해도 다시 실행됩니다. systemd로 관리하려면 `deploy/team-fortune-bot.service`의 WorkingDirectory를 서버의 저장소 폴더로 바꿔서 사용해 주세요.
- 데이터: `fortune-data` 볼륨에 보관합니다. `docker compose down -v`는 볼륨을 삭제하므로 사용하지 않습니다.
- 실행 단위: 컨테이너 하나로만 실행합니다. 같은 DB를 여러 봇 인스턴스에 연결하지 않습니다.
- 도메인 변경 시 함께 바꿀 항목: `.env`의 `PUBLIC_BASE_URL`, DNS·Caddy, Azure 봇 메시지 엔드포인트, `appPackage/manifest.json`의 `validDomains`

코드 업데이트 반영

```bash
cd ~/workspace/teams-fortune-bot
git pull --ff-only
docker compose up -d --build
```

서버 코드만 바뀐 경우에는 Teams 앱을 다시 설치하지 않아도 됩니다.

## Teams 앱 등록과 설치

- 등록: Teams Developer Portal과 Azure Bot에서 쓱부엉 앱을 등록합니다.
- 서버 설정과 일치 필요: 봇 ID, 비밀값, 테넌트
- 조직에서 사용자 지정 앱 업로드를 허용해야 합니다.

ZIP 만들기(프로젝트 최상단에서 실행)

```bash
bash scripts/package-teams-app.sh
```

- 출력 파일: `dist/team-fortune-bot-YYYYMMDD-HHMMSS.zip` (한국 시간 기준)
- 포함 파일: `manifest.json`, `color.png`(192×192), `outline.png`(32×32, 투명 배경 흰색 단색). 비밀값은 들어가지 않습니다.
- 앱 ID: 환경 변수나 `.env`의 `MicrosoftAppId`(UUID 형식)로 manifest를 채웁니다. `.env`를 셸 코드로 실행하지 않습니다.
- 윤곽선 아이콘을 고칠 때는 `appPackage/outline.svg`를 수정한 뒤 `rsvg-convert -w 32 -h 32 appPackage/outline.svg -o appPackage/outline.png`로 다시 변환합니다.
- 현재 manifest 버전: 1.0.0

설치와 업데이트

- 처음 설치: Teams 앱 관리 화면에서 **사용자 지정 앱 업로드**로 ZIP을 올린 뒤 단체 대화방에 추가해 주세요.
- 업데이트: 이름·아이콘·manifest를 바꾸면 manifest의 `version`을 올리고, 새 ZIP을 같은 방법으로 업로드해 주세요. 앱을 삭제하고 다시 설치할 필요는 없습니다.
- 주의: ZIP으로 설치한 앱은 Developer Portal에서 버전을 올려도 업데이트되지 않습니다.

## 실기 확인 순서

실제 Teams 확인은 소유자가 앱을 설치한 뒤 아래 순서로 진행합니다.

1. 카드 펼침 확인: `npm run card:preview -- 2026-11-27`로 만든 `dist/card-2026-11-27.json`을 Teams에 표시해, 데스크톱과 모바일에서 띠 줄을 누르면 상세 운세가 펼쳐지고 다시 누르면 접히는지 확인합니다. 줄 전체 누르기가 동작하지 않는 클라이언트가 있으면 설계 문서 6절 대안(줄 끝 작은 펼치기 버튼)으로 바꾸고, 그것도 동작하지 않으면 카드 형태를 다시 정합니다.
2. 설치 인사: 단체 대화방에 앱을 추가하면 「저… 평일 아침 9시에 쪽지 두고 갈게요… (쓱)」 인사가 한 번 오는지 확인합니다.
3. 정기 발송: 다음 업무일 09시대에 카드가 대화방마다 한 번씩 오는지, 아이콘과 생일 쪽지가 제대로 보이는지 확인합니다.
4. 멘션 재요청: `@쓱부엉`을 보내 같은 날 같은 내용의 카드가 다시 오는지 확인합니다.

## 예상 비용

실제 Gemini 호출의 토큰 사용량은 아직 측정하지 않았습니다. 아래는 설계 문서 11절의 추정값이며, 운영 후 실제 사용량으로 다시 계산합니다.

- 단가: Gemini Developer API 가격표 기준 `gemini-3.6-flash` 유료(Standard) 단가는 100만 토큰당 입력 0.75달러, 출력 3.75달러(2026-12-31까지)이고, 2027-01-01부터 입력 1.50달러, 출력 7.50달러입니다.
- 가정: 1회 호출에 입력 약 2,500토큰, 출력 약 5,500토큰(사고 토큰 포함)
- 추정: 2027년 단가로 1회 약 0.05달러, 연간 업무일 약 250일 기준 연 11달러 안팎
- LLM 호출은 하루 한 번이며 대화방 수와 멘션 재요청 횟수와 관계없습니다.
- 무료 등급은 입력 내용이 Google 제품 개선에 쓰일 수 있으므로 어느 등급을 쓸지는 운영자가 정합니다. 이름과 생일은 LLM에 보내지 않습니다.

출처: [설계 문서 11절](docs/superpowers/specs/2026-11-26-team-fortune-bot-design.md), Google AI for Developers [Gemini Developer API pricing](https://ai.google.dev/gemini-api/docs/pricing)(설계 문서 작성 시 2026-11-26 확인)

## 장애 확인

```bash
docker compose logs --tail=100 bot
```

| 로그 | 의미 |
| --- | --- |
| `[llm] 템플릿 사용:` | Gemini 호출 실패나 응답 검증 실패로 그날 문장을 템플릿으로 바꿈. 뒤에 이유가 붙습니다. |
| `[발송] 운세 카드 발송 실패:` | 해당 대화방 발송 실패. 10시 전이면 다음 주기(30초 뒤)에 다시 보냅니다. |
| `[정기 발송] 이번 주기 실행 실패` | 주기 전체가 실패. 다음 주기에 다시 시도합니다. |
| `공휴일 표에 YYYY년이 없습니다` | `src/holidays.ts`에 그해 공휴일 추가 필요 |
| `GEMINI_API_KEY가 없어 템플릿 문장만 씁니다` | `.env`에 키가 없어 LLM을 부르지 않는 상태 |

발송 도중 프로세스가 멈춰 완료 기록이 없는 대화방은 5분 뒤 다시 발송 대상이 됩니다.

## 백업

- DB에는 대화방 식별자, 날짜별 운세(생일 쪽지의 이름 포함), 발송 기록이 들어 있습니다. 데이터와 백업 파일의 접근 권한을 제한해 주세요.
- 기록은 자동으로 삭제하지 않습니다.

```bash
mkdir -p backups
docker compose stop bot
docker cp team-fortune-bot:/data/team-fortune-bot.sqlite "backups/team-fortune-bot-$(date +%Y%m%d-%H%M%S).sqlite"
docker compose start bot
```

복원할 때는 봇을 멈추고 현재 DB를 따로 보관한 뒤 백업 파일을 복사해 주세요.

## 참고 문서

- [설계 문서](docs/superpowers/specs/2026-11-26-team-fortune-bot-design.md)
- [구현 계획](docs/superpowers/plans/2026-11-26-team-fortune-bot.md)
- [카드 시안](docs/superpowers/specs/mockup/index.html)
