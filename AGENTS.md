# coolvm 작업 가이드 (AGENTS)

이 파일의 스코프는 레포지토리 전체(`/workspace/coolvm`)입니다.

## 목적

- `coolvm`은 TypeScript/Bun 기반의 교육용 VM/ISA 프로젝트입니다.
- 현재 `cool8`, `cool16` 구현과 `cool32` 문서 스켈레톤이 공존합니다.
- 변경 시 "아키텍처 문서(README) ↔ 구현 코드 ↔ 샘플/CLI 동작"의 일관성을 우선합니다.

## 필수 작업 규칙

- 커밋 전 반드시 포맷 실행:
  - `bun run format`
- 가능하면 포맷 검증도 함께 실행:
  - `bun run format:check`

## 권장 점검 절차

1. 영향 범위 파악 (`src/cool8`, `src/cool16`, 루트 문서 중 어디인지).
2. 관련 테스트 파일(`*.test.ts`)이 있으면 함께 갱신.
3. 샘플 ASM(`samples/*.asm`)이 깨지지 않는지 최소 1개 이상 실행 확인.
4. 문서(README)의 명령어/옵션/동작 설명이 코드와 맞는지 확인.

## 빠른 실행 명령

- 루트 엔트리 실행: `bun run src/index.ts`
- cool16 CLI 예시:
  - `bun src/cool16/cli.ts run src/cool16/samples/hello.asm`
  - `bun src/cool16/cli.ts asm src/cool16/samples/hello.asm`
  - `bun src/cool16/cli.ts dis <file.bin>`

## 코드 변경 가이드

- 기존 네이밍/명령어 인코딩 스타일을 유지하고, 새 추상화 도입은 최소화합니다.
- ISA 의미를 바꾸는 변경은 반드시 문서(`README.md`, 각 ISA README)를 동반 수정합니다.
- 디스어셈블러/어셈블러는 가능한 한 역변환 가능성(round-trip)을 해치지 않게 유지합니다.
- `r0`(zero register), 즉시값 부호 확장/제로 확장 규칙 등 ISA 핵심 불변식을 깨지 않도록 주의합니다.

## 문서 작성 규칙

- 리포의 기존 문서 언어(영문/국문 혼재)를 존중하되, 한 파일 내 톤은 일관되게 유지합니다.
- 사용자가 실행 가능한 명령은 복붙 가능한 형태로 제시합니다.

## 커밋/PR 규칙

- 변경 요지를 한 줄로 설명할 수 있는 명확한 커밋 메시지를 사용합니다.
- PR 본문에는 아래를 포함합니다:
  - 무엇을 왜 바꿨는지
  - 핵심 파일
  - 검증 방법(실행한 명령)
