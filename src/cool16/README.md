# cool16

`cool16`은 교육용 16비트 RISC ISA와 툴체인(어셈블러/VM/디스어셈블러/CLI)입니다.

이 문서는 기존 `src/specs/cool16.md`의 ISA 설명과 기존 `src/cool16/README.md`의 실사용 가이드를 통합한 버전입니다.

## 설계 철학

- 고정 길이 16비트 명령어
- Load/Store 아키텍처
- 조건 코드 레지스터(플래그) 없음
- 간단한 디코더와 명시적 제어 흐름

의도적으로 제외한 것:

- 가변 길이 명령어
- 지연 슬롯
- 복잡한 주소 지정 모드
- 암묵적 스택 엔진

## 프로그래머 모델

### 레지스터

아키텍처 레지스터는 8개(`r0`~`r7`)이며 모두 16비트입니다.

| 레지스터 | 역할 |
|---|---|
| `r0` | 고정 0 (읽기=0, 쓰기 무시) |
| `r1`~`r5` | 일반 목적 |
| `r6` | `sp`(stack pointer) 관례 |
| `r7` | `lr`(link register) 관례 |

추가 별칭:

- `sp` = `r6`
- `lr` = `r7`
- 일부 RISC-V 호환 별칭(`x0` 등)도 어셈블러에서 지원

### 메모리

- 64KiB 바이트 주소 공간 (`0x0000`~`0xFFFF`)
- 워드 크기 16비트
- 리틀 엔디언
- `LW`/`SW`는 짝수 주소 정렬 필요
- `LB`/`SB`는 임의 주소 허용

## 인코딩 요약

모든 명령어는 16비트입니다.

- **R 형식**: `op(4) rd(3) rs1(3) rs2(3) func(3)`
- **I 형식**: `op(4) rd(3) rs1(3) imm6(6)`
- **M 형식**: `op(4) reg(3) base(3) imm6(6)`
- **B 형식**: `op(4) rs1(3) rs2(3) imm6(6)`
- **J 형식**: `op(4) imm12(12)`

즉시값 규칙:

- `ADDI`, 메모리 오프셋, 분기: sign-extend
- `ANDI/ORI/XORI`: zero-extend
- 분기/점프 기준 PC는 현재 PC가 아니라 `PC+2`
- `BEQ/BNE`, `JAL` 오프셋은 내부적으로 1비트 좌시프트된 word-step 오프셋

## ISA

### ALU (R-format, `op=0x0`)

- `ADD rd, rs1, rs2`
- `SUB rd, rs1, rs2`
- `AND rd, rs1, rs2`
- `OR  rd, rs1, rs2`
- `XOR rd, rs1, rs2`
- `SLT rd, rs1, rs2` (signed)
- `SLTU rd, rs1, rs2` (unsigned)
- `JALR rd, rs1` (특수 subgroup)

### 즉시값 ALU

- `ADDI rd, rs1, imm6`
- `ANDI rd, rs1, imm6`
- `ORI  rd, rs1, imm6`
- `XORI rd, rs1, imm6`
- `SLLI rd, rs1, imm6`
- `SRLI rd, rs1, imm6`
- `SRAI rd, rs1, imm6`

### 메모리

- `LW rd, off(base)`
- `SW rs, off(base)`
- `LB rd, off(base)` (sign-extend load)
- `SB rs, off(base)`

### 분기/점프

- `BEQ rs1, rs2, target`
- `BNE rs1, rs2, target`
- `JAL target` (link는 `r7`에 저장)
- `JALR rd, rs1`

### 시스템

- `ECALL`, `EBREAK`, `ERET`, `FENCE`
- `CSRR rd, csr`, `CSRW csr, rs`

CLI 기본 러너(`cool16 run`)의 `ECALL` 처리:

- `r1=0`: `putchar(r2)` 수행 후 계속 실행
- 그 외(`r1=1` 포함): 프로그램 halt

## 어셈블리 문법

### 주석

- `;` 또는 `#` 이후는 주석

### 레이블

```asm
loop:
  ADDI r1, r1, 1
```

로컬 레이블(`.loop`)을 지원하며 최근 글로벌 레이블 스코프에 바인딩됩니다.

### 리터럴

- 10진: `42`, `-7`
- 16진: `0x2A`
- 2진: `0b101010`

### 데이터/상수 지시어

- `.equ NAME, value`
- `.byte b0, b1, ...`
- `.ascii "text\n\0"`

`.byte`/`.ascii`는 바이트 단위를 리틀엔디언 워드로 패킹하며, 홀수 바이트면 0으로 패딩됩니다.

## 지원하는 의사 명령어

- `NOP` -> `ADD r0, r0, r0`
- `MOV rd, rs` (`MV` 별칭 포함)
- `NEG rd, rs`
- `NOT rd, rs`
- `RET` -> `JALR r0, r7`
- `JR rs` -> `JALR r0, rs`
- `J label` -> `JMP label`
- `BEQZ rs, label` -> `BEQ rs, r0, label`
- `BNEZ rs, label` -> `BNE rs, r0, label`
- `SEQZ rd, rs`
- `LI rd, imm16/label` (필요 시 여러 명령으로 확장)
- `PUSH rs`, `POP rd`

## CLI 사용법

```bash
bun src/cool16/cli.ts run <file.asm>
bun src/cool16/cli.ts asm <file.asm>
bun src/cool16/cli.ts dis <file.bin>
```

옵션:

- `--trace`
- `--max-cycles <n>`

## 샘플 프로그램

### `samples/hello.asm`

문자열을 `.ascii`로 배치하고 `ECALL putchar(r1=0)`로 문자 단위 출력:

```bash
bun src/cool16/cli.ts run src/cool16/samples/hello.asm
```

예상 출력:

```text
Hello, World!
```

### `samples/fibonacci.asm`

반복문으로 `fib(N)` 계산 후 `ECALL exit(r1=1)`로 종료.
기본 `N=10`이면 결과는 `55`이며 실행 후 레지스터 덤프의 `r2`(exit 인자)에서 확인 가능합니다.

```bash
bun src/cool16/cli.ts run src/cool16/samples/fibonacci.asm
```

## 구현 위치

- ISA/VM 코어: `src/cool16/core.ts`
- 어셈블러: `src/cool16/assembler.ts`
- 디스어셈블러: `src/cool16/disassembler.ts`
- CLI: `src/cool16/cli.ts`
- 샘플: `src/cool16/samples/*.asm`
