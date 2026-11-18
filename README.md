# 노유킹네 집 가계부 프로그램

로그인 없이 사용할 수 있는 React · TypeScript · Vite 대시보드입니다. 자산과 부채 잔액, 대출 금리·월 상환액·만기, 월별 현금흐름 및 월말 순자산 스냅샷을 기록할 수 있습니다. 화폐 단위는 원(KRW)입니다.

## 데이터 보관

웹앱은 기본 화면에서 지정된 [Google Sheets 원장](https://docs.google.com/spreadsheets/d/1DkO-A0tAQS6825b1DRIEbntCuyRanRMNKKzWX8FV-TQ/edit)을 읽습니다. 공유를 **링크가 있는 모든 사용자 → 뷰어**로 설정하고 수정할 계정은 개별 편집자로 추가합니다. 웹앱과 시트 주소를 접할 수 있는 사람은 누구나 원장을 볼 수 있습니다. 시트에서 수정한 뒤 웹 화면의 **다시 불러오기**를 누르면 변경 사항이 표시됩니다.

아래 탭과 첫 행을 만듭니다. 빈 탭에도 헤더를 입력합니다. ID와 ISO 날짜·시각 열은 일반 텍스트 형식으로 설정하면 자동 변환을 피할 수 있습니다. 각 탭의 첫 행 아래에 한 행씩 입력합니다.

| 탭 | 첫 행 (열 순서) | 값 |
| --- | --- | --- |
| 자산부채 | `id, kind, name, group, amount, rate, payment, due, active, purchasePrice` | 고유 ID, `asset` 또는 `debt`, 이름, 분류, 원 단위 정수, 연 금리(% 수치), 월 상환액(원), 만기(YYYY-MM-DD), TRUE/FALSE. 부동산 매입가. 금리·상환액·만기·활성 여부·매입가는 생략 가능 |
| 현금흐름 | `id, day, kind, name, amount, category, person, account` | 고유 ID, YYYY-MM-DD, `income` 또는 `expense`, 거래 설명, 양의 원 단위 정수, 표준 분류, 사람, 계좌. 마지막 세 열은 기존 원장에서 생략 가능 |
| 월말스냅샷 | `month, assets, debts` | YYYY-MM, 총자산(원), 총부채(원). 월마다 한 행 |
| 변경이력 | `at, actor, action, target, before, after` | ISO 시각, 수정자, 명령 유형, 대상 ID, 수정 전 값, 수정 후 값. 시트에서 직접 한 수정은 이 탭에 자동 기록되지 않음 |

웹에서는 공유 원장 조회와 시각화를 제공합니다. 대시보드 상단의 **새로고침**으로 변경사항을 다시 불러옵니다. 공유 시트를 채팅에서 수정하려면 인증되고 편집 권한이 있는 Google Sheets 쓰기 연결이 필요합니다.

## 개발 및 검증

Node.js 24를 사용합니다.

```bash
npm ci
npm test
npm run dev
npm run build
```

## GitHub Pages

저장소 **Settings → Pages → Build and deployment → Source**에서 **GitHub Actions**를 선택합니다. 저장소 플랜이 비공개 저장소의 Pages 배포를 지원하는 경우 비공개 설정을 유지할 수 있습니다. 이후 `main`에 푸시하거나 **Actions → Deploy GitHub Pages → Run workflow**를 실행합니다. 배포 주소는 실행 결과 또는 Pages 설정에서 확인할 수 있습니다.

## 월별 자산 그래프

자산별 추이와 월별 변경 내역은 변경이력 탭에 남긴 `position` 기록과 현재 자산부채 잔액을 바탕으로 표시합니다. 시트에서 잔액만 덮어쓰면 과거 월별 값이 생성되지 않습니다. 부동산 매입가 점선은 `purchasePrice`가 기록된 항목에 표시합니다.

## 원장 모델

- `positions`는 고유 ID로 관리되는 자산·부채 마스터입니다. 보유 목록에서 제외된 항목도 이력과 함께 유지합니다.
- `flows`는 거래일, 수입·지출 유형, 이름과 금액을 보관합니다.
- `snapshots`는 월을 키로 월말 총자산과 총부채를 보관합니다. 순자산은 두 값의 차이입니다.
- `history`는 명령 적용 전후의 값을 기록합니다.

`src/model.ts`의 `Command`와 `applyCommand`가 입력 검증 및 이력 생성을 담당하고, `src/store.ts`가 저장을 담당합니다. 향후 자연어 입력은 구조화된 명령 초안을 생성하고 화면에서 확인을 받은 뒤 같은 검증 경로를 사용하면 됩니다.
