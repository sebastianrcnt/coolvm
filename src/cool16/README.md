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

| 레지스터  | 역할                       |
| --------- | -------------------------- |
| `r0`      | 고정 0 (읽기=0, 쓰기 무시) |
| `r1`~`r5` | 일반 목적                  |
| `r6`      | `sp`(stack pointer) 관례   |
| `r7`      | `lr`(link register) 관례   |

추가 별칭:

- `sp` = `r6`
- `lr` = `r7`
- 일부 RISC-V 호환 별칭(`x0` 등)도 어셈블러에서 지원

### 메모리

- 64KiB 바이트 주소 공간 (`0x0000`~`0xFFFF`)
- 워드 크기 16비트
- 리틀 엔디언
- `LW`/`SW`는 짝수 주소 정렬 필요 (위반 시 `MISALIGNED_ACCESS` 트랩)
- `LB`/`SB`는 임의 주소 허용

### 특권 모드

프로세서는 두 가지 특권 모드를 지원합니다.

| 모드       | STATUS.PRIV 비트 | 설명                         |
| ---------- | ----------------- | ---------------------------- |
| Supervisor | 1                 | 초기 모드. CSR/ERET 접근 가능 |
| User       | 0                 | CSR/ERET 사용 시 트랩 발생    |

리셋 시 Supervisor 모드로 진입하며 인터럽트는 비활성화됩니다.

### CSR (Control and Status Registers)

CSR 주소 공간은 6비트(0x00~0x3F, 64슬롯)입니다. 정의된 CSR은 다음과 같습니다:

| 주소   | 이름      | 설명                                            |
| ------ | --------- | ----------------------------------------------- |
| `0x00` | `STATUS`  | 상태 레지스터                                   |
| `0x01` | `ESTATUS` | 트랩 진입 시 이전 STATUS 백업                   |
| `0x02` | `EPC`     | 트랩 진입 시 복귀 PC 저장                       |
| `0x03` | `CAUSE`   | 트랩 원인 코드                                  |
| `0x04` | `IVEC`    | 인터럽트/트랩 벡터 테이블 베이스 주소           |

나머지 주소(0x05~0x3F)는 예약이며, 읽으면 0을 반환하고 쓰기는 무시됩니다.

CSR 접근(`CSRR`/`CSRW`)은 **Supervisor 모드에서만** 허용됩니다. User 모드에서 시도 시 `ILLEGAL_INSTRUCTION` 트랩이 발생합니다.

#### STATUS 레지스터 비트맵

| 비트 | 이름   | 설명                                  |
| ---- | ------ | ------------------------------------- |
| 0    | `IE`   | 인터럽트 활성화 (1=활성, 0=비활성)    |
| 1    | `PRIV` | 특권 수준 (1=Supervisor, 0=User)      |
| 2~15 | —      | 예약 (0)                              |

### MMIO UART (기본 매핑)

레퍼런스 VM은 UART를 MMIO로 노출합니다.

| 주소     | 이름            | 접근              | 설명                                                                                 |
| -------- | --------------- | ----------------- | ------------------------------------------------------------------------------------ |
| `0xFF00` | `UART_TXDATA`   | byte write        | TX ready일 때 low 8-bit 문자 전송 시작                                               |
| `0xFF02` | `UART_RXDATA`   | byte read         | 수신 바이트 읽기 (읽으면 RX valid 클리어)                                            |
| `0xFF04` | `UART_STATUS`   | byte read/write   | bit0 `TX_READY`(RO), bit1 `RX_VALID`(RO), bit2 `TX_IRQ_EN`(RW), bit3 `RX_IRQ_EN`(RW) |
| `0xFF06` | `UART_BAUD_DIV` | 16-bit read/write | UART bit당 CPU cycle 수 (최소 1)                                                     |

UART MMIO 영역은 `0xFF00`~`0xFF07` (8바이트)입니다. 이 범위의 읽기/쓰기는 일반 메모리가 아닌 UART 장치로 라우팅됩니다.

TX 지연 모델은 8N1 프레임(`10`비트/바이트)이므로, 바이트 1개 전송에 `UART_BAUD_DIV * 10` 사이클이 필요합니다.

## 인코딩 요약

모든 명령어는 16비트입니다.

- **R 형식**: `op(4) rd(3) rs1(3) rs2(3) func(3)`
- **I 형식**: `op(4) rd(3) rs1(3) imm6(6)`
- **M 형식**: `op(4) reg(3) base(3) imm6(6)`
- **B 형식**: `op(4) rs1(3) rs2(3) imm6(6)`
- **J 형식**: `op(4) rd(3) imm9(9)`
- **U 형식**: `op(4) rd(3) imm9(9)`
- **S 형식**: `op(4) sub(3) reg(3) csr(6)`

즉시값 규칙:

- `ADDI`, 메모리 오프셋, 분기: sign-extend
- `ANDI/ORI/XORI`: zero-extend
- 분기/점프 기준 PC는 현재 PC가 아니라 `PC+2`
- `BEQ/BNE`, `JAL` 오프셋은 내부적으로 1비트 좌시프트된 word-step 오프셋

## ISA

### 옵코드 맵

| op (4비트) | 값     | 형식 | 명령어              |
| ---------- | ------ | ---- | ------------------- |
| `0x0`      | `0000` | R    | ALU (func로 구분)   |
| `0x1`      | `0001` | I    | ADDI                |
| `0x2`      | `0010` | I    | ANDI                |
| `0x3`      | `0011` | I    | ORI                 |
| `0x4`      | `0100` | I    | XORI                |
| `0x5`      | `0101` | I    | SLLI                |
| `0x6`      | `0110` | I    | SRLI                |
| `0x7`      | `0111` | U    | LUI                 |
| `0x8`      | `1000` | M    | LW                  |
| `0x9`      | `1001` | M    | SW                  |
| `0xA`      | `1010` | J    | JAL                 |
| `0xB`      | `1011` | S    | SYS (sub로 구분, SRAI 포함) |
| `0xC`      | `1100` | M    | LB                  |
| `0xD`      | `1101` | M    | SB                  |
| `0xE`      | `1110` | B    | BEQ                 |
| `0xF`      | `1111` | B    | BNE                 |

### ALU (R-format, `op=0x0`)

func 필드(bits 2:0)로 연산을 구분합니다:

| func    | 값    | 명령어               | 동작                           |
| ------- | ----- | -------------------- | ------------------------------ |
| `000`   | 0     | `ADD rd, rs1, rs2`   | rd = rs1 + rs2                 |
| `001`   | 1     | `SUB rd, rs1, rs2`   | rd = rs1 - rs2                 |
| `010`   | 2     | `AND rd, rs1, rs2`   | rd = rs1 & rs2                 |
| `011`   | 3     | `OR  rd, rs1, rs2`   | rd = rs1 \| rs2                |
| `100`   | 4     | `XOR rd, rs1, rs2`   | rd = rs1 ^ rs2                 |
| `101`   | 5     | `SLT rd, rs1, rs2`   | rd = (signed)rs1 < rs2 ? 1 : 0|
| `110`   | 6     | `SLTU rd, rs1, rs2`  | rd = (unsigned)rs1 < rs2 ? 1:0|
| `111`   | 7     | SPECIAL (아래 참조)  | —                              |

#### SPECIAL 서브그룹 (`func=0b111`)

`func=0b111`일 때 `rs2` 필드로 세부 명령어를 구분합니다:

| rs2     | 명령어            | 인코딩                                    | 동작                              |
| ------- | ----------------- | ----------------------------------------- | --------------------------------- |
| `0b111` | `JALR rd, rs1`    | `0000_ddd_sss_111_111`                    | rd = PC+2; PC = rs1               |

`func=0b111`이면서 `rs2 ≠ 0b111`인 인코딩은 예약이며, `ILLEGAL_INSTRUCTION` 트랩을 발생시킵니다.

### 즉시값 ALU (I-format)

| 명령어                  | 즉시값 처리                       | 동작                           |
| ----------------------- | --------------------------------- | ------------------------------ |
| `ADDI rd, rs1, imm6`   | sign-extend 6→16                  | rd = rs1 + sext(imm6)         |
| `ANDI rd, rs1, imm6`   | zero-extend 6→16                  | rd = rs1 & zext(imm6)         |
| `ORI  rd, rs1, imm6`   | zero-extend 6→16                  | rd = rs1 \| zext(imm6)        |
| `XORI rd, rs1, imm6`   | zero-extend 6→16                  | rd = rs1 ^ zext(imm6)         |

#### 시프트 명령어 (I-format, 시프트량 제한)

시프트 명령어는 I-format을 사용하지만, 즉시값 필드 6비트 중 **하위 4비트(bits 3:0)만 시프트량(shamt)으로 사용**합니다. 유효 범위는 0~15이며, 상위 2비트(bits 5:4)는 예약으로 **0이어야** 합니다.

| 명령어                  | 동작                               |
| ----------------------- | ---------------------------------- |
| `SLLI rd, rs1, shamt`   | rd = rs1 << shamt (논리 좌시프트)  |
| `SRLI rd, rs1, shamt`   | rd = rs1 >>> shamt (논리 우시프트) |

> `SRAI`는 S-format(SYS sub=011)으로 인코딩됩니다. 아래 [시스템 섹션](#시스템-sys-s-format-op0xb)을 참조하세요.

### LUI (U-format, `op=0x7`)

인코딩: `op(4) rd(3) imm9(9)`

동작: `rd ← imm9 << 7` (하위 7비트는 0)

9비트 unsigned 즉시값을 7비트 좌시프트하여 레지스터 상위 9비트를 설정합니다. 이후 `ORI rd, rd, low6`로 하위 6비트를 채우면 bit 6 = 0인 임의의 16비트 값을 2개 명령어로 로딩할 수 있습니다.

```asm
LUI  r1, 0x24       ; r1 = 0x1200  (0x24 << 7)
ORI  r1, r1, 0x34   ; r1 = 0x1234
```

bit 6 = 1인 값은 `LI` 의사명령이 자동으로 5-instruction 폴백으로 처리합니다.

### 메모리 (M-format)

오프셋은 6비트 sign-extend입니다. 유효 주소 = `regs[base] + sext(imm6)`.

| 명령어              | 동작                                                      |
| ------------------- | --------------------------------------------------------- |
| `LW rd, off(base)`  | rd = mem16[addr] (짝수 정렬 필수, 위반 시 MISALIGNED 트랩)|
| `SW rs, off(base)`  | mem16[addr] = rs (짝수 정렬 필수, 위반 시 MISALIGNED 트랩)|
| `LB rd, off(base)`  | rd = sext(mem8[addr]) (sign-extend byte load)             |
| `SB rs, off(base)`  | mem8[addr] = rs[7:0]                                      |

### 분기/점프

#### BEQ / BNE (B-format, `op=0xE` / `op=0xF`)

인코딩: `op(4) rs1(3) rs2(3) imm6(6)`

오프셋 = `sext(imm6) << 1`, 기준 PC = `PC+2`.

분기 범위: PC+2 기준 -64 ~ +62 바이트.

| 명령어                  | 조건              |
| ----------------------- | ----------------- |
| `BEQ rs1, rs2, target`  | rs1 == rs2        |
| `BNE rs1, rs2, target`  | rs1 != rs2        |

#### JAL (J-format, `op=0xA`)

인코딩: `op(4) rd(3) imm9(9)`

동작: `rd = PC+2; PC = PC+2 + (sext(imm9) << 1)`

점프 범위: PC+2 기준 -512 ~ +510 워드(= -1024 ~ +1020 바이트).

`JAL target` 구문은 기본적으로 `rd=r7`(link register)에 복귀 주소를 저장합니다.

#### JALR (R-format SPECIAL, `op=0x0`, `func=0b111`, `rs2=0b111`)

인코딩: `0000_ddd_sss_111_111` (16비트)

동작: `rd = PC+2; PC = regs[rs1]`

간접 점프/함수 호출 복귀에 사용합니다. `JALR r0, r7`은 `RET` 의사명령어에 해당합니다.

### 시스템 (SYS, S-format, `op=0xB`)

인코딩: `op(4) sub(3) reg(3) csr(6)`

`sub` 필드(bits 11:9)로 세부 명령어를 구분합니다:

| sub     | 값  | 명령어            | 필수 조건                     | 동작                                          |
| ------- | --- | ----------------- | ----------------------------- | --------------------------------------------- |
| `000`   | 0   | `ECALL`           | reg=0, csr=0                  | 트랩 발생 (아래 참조)                         |
| `001`   | 1   | `EBREAK`          | reg=0, csr=0                  | BREAKPOINT 트랩                               |
| `010`   | 2   | `ERET`            | reg=0, csr=0, Supervisor 모드 | PC=EPC, STATUS=ESTATUS                        |
| `011`   | 3   | `SRAI rd, rs1, shamt` | reg=rd, csr[5:3]=rs1, csr[2:0]=shamt | rd = (signed)rs1 >> shamt (shamt: 0-7) |
| `100`   | 4   | `CSRR rd, csr`    | Supervisor 모드               | rd = CSR[csr]                                 |
| `101`   | 5   | `CSRW csr, rs`    | Supervisor 모드               | CSR[csr] = regs[rs]                           |
| `110-111`| — | —                 | —                             | 예약 (ILLEGAL_INSTRUCTION)                    |

**예약 비트 규칙**: ECALL/EBREAK/ERET에서 `reg`과 `csr` 필드는 반드시 0이어야 합니다. 0이 아닌 값은 `ILLEGAL_INSTRUCTION` 트랩을 발생시킵니다.

**SRAI 제한**: shamt는 3비트(0-7)입니다. 기존 SRAI I-format(shamt 0-15)에서 변경됐으므로 주의하세요.

**권한 규칙**: ERET/CSRR/CSRW는 Supervisor 모드에서만 실행 가능합니다. User 모드에서 실행 시 `ILLEGAL_INSTRUCTION` 트랩이 발생합니다.

## 트랩 및 인터럽트

### 트랩 원인 코드

| 코드 | 이름                    | 유형   | 설명                                |
| ---- | ----------------------- | ------ | ----------------------------------- |
| 0    | `ILLEGAL_INSTRUCTION`   | 동기   | 잘못된 명령어 인코딩 또는 권한 위반 |
| 1    | `MISALIGNED_ACCESS`     | 동기   | LW/SW 홀수 주소 접근                |
| 2    | `ECALL_USER`            | 동기   | User 모드에서의 ECALL               |
| 3    | `ECALL_SUPERVISOR`      | 동기   | Supervisor 모드에서의 ECALL         |
| 4    | `BREAKPOINT`            | 동기   | EBREAK 명령어                       |
| 5    | `EXTERNAL_INTERRUPT`    | 비동기 | UART 인터럽트                       |

### 트랩 진입 시퀀스

동기 트랩(예외)이 발생하면:

1. `EPC` ← 현재 PC (트랩을 유발한 명령어의 주소)
2. `ESTATUS` ← 현재 `STATUS`
3. `STATUS.IE` ← 0 (인터럽트 비활성화)
4. `STATUS.PRIV` ← 1 (Supervisor 모드 진입)
5. `PC` ← `IVEC + (cause << 1)`

비동기 인터럽트의 경우:

1. `EPC` ← 다음 PC (인터럽트 시점의 복귀 주소, 즉 아직 실행되지 않은 명령어)
2. 나머지는 동기 트랩과 동일

### 인터럽트 벡터 테이블

`IVEC` CSR은 벡터 테이블의 베이스 주소를 지정합니다. 각 트랩 원인은 `IVEC + (cause × 2)` 주소로 점프합니다.

벡터 엔트리 간격이 2바이트(1워드 = 1명령어)이므로, 각 엔트리에는 실제 핸들러로의 `JAL` 명령어를 배치하는 것이 일반적입니다:

```
; 벡터 테이블 예시 (IVEC가 이 주소를 가리킨다고 가정)
vector_table:
  JAL illegal_handler     ; cause 0: ILLEGAL_INSTRUCTION
  JAL misalign_handler    ; cause 1: MISALIGNED_ACCESS
  JAL ecall_u_handler     ; cause 2: ECALL_USER
  JAL ecall_s_handler     ; cause 3: ECALL_SUPERVISOR
  JAL break_handler       ; cause 4: BREAKPOINT
  JAL irq_handler         ; cause 5: EXTERNAL_INTERRUPT
```

### 인터럽트 조건

외부 인터럽트(`CAUSE=5`)는 다음 조건이 **모두** 충족될 때 명령어 실행 전에 확인됩니다:

1. `STATUS.IE` = 1 (인터럽트 활성화)
2. UART에서 인터럽트 조건 발생:
   - TX ready **이고** `TX_IRQ_EN` 비트 설정, 또는
   - RX valid **이고** `RX_IRQ_EN` 비트 설정

### 트랩 복귀 (ERET)

`ERET` 실행 시:

1. `PC` ← `EPC`
2. `STATUS` ← `ESTATUS`

이를 통해 트랩 이전의 특권 수준과 인터럽트 상태가 복원됩니다.

## ECALL과 CLI 러너

CLI 기본 러너(`cool16 run`)에서 `ECALL`은 트랩 시퀀스를 수행한 후 콜백을 호출합니다. 콜백에서의 처리:

- `r1=0`: `putchar(r2)` — 문자 출력 후 실행 계속
- 그 외(`r1=1` 포함): 프로그램 halt

> **주의**: ECALL은 항상 트랩 시퀀스(EPC/ESTATUS 저장, IVEC 점프)를 먼저 수행합니다. CLI 러너의 putchar 동작에서 실행을 계속하려면, IVEC가 적절히 설정되어 있거나 콜백 내에서 PC를 직접 조정해야 합니다. 베어메탈 환경에서는 ECALL 핸들러를 벡터 테이블에 등록하여 사용합니다.

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

| 의사 명령어           | 확장                        |
| --------------------- | --------------------------- |
| `NOP`                 | `ADD r0, r0, r0`            |
| `MOV rd, rs` (`MV`)  | `ADD rd, rs, r0`            |
| `NEG rd, rs`          | `SUB rd, r0, rs`            |
| `NOT rd, rs`          | `XORI rd, rs, 0x3F`        |
| `RET`                 | `JALR r0, r7`               |
| `JR rs`               | `JALR r0, rs`               |
| `J label` (`JMP`)    | `JAL r0, label`             |
| `BEQZ rs, label`      | `BEQ rs, r0, label`         |
| `BNEZ rs, label`      | `BNE rs, r0, label`         |
| `SEQZ rd, rs`         | `SLTU rd, r0, rs` (주의)    |
| `LI rd, imm16/label`  | 소형: `ADDI`(1) / bit6=0: `LUI+ORI`(2) / 기타: 5명령 폴백 |
| `PUSH rs`             | `SW rs, 0(sp)` + `ADDI sp, sp, -2` |
| `POP rd`              | `ADDI sp, sp, 2` + `LW rd, 0(sp)` |

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