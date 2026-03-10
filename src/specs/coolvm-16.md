# COOLVM-16: A Clean 16-Bit Educational CPU Architecture

> *"What if we designed a 16-bit CPU in 2026, knowing everything we know now?"*

---

## 1. Design Philosophy

COOLVM-16 is a 16-bit RISC processor designed for education. It reflects modern CPU design principles: load/store execution, fixed-width instructions, explicit control flow, no condition-code register, and a small decode footprint suitable for both an emulator and a simple FPGA core.

**What we keep from modern CPUs:**
- Fixed-width 16-bit instructions
- Load/store architecture
- PC-relative control flow
- Uniform integer register file
- Compare in registers, not via hidden flags

**What we intentionally omit:**
- No condition flags register
- No variable-length instructions
- No delay slots
- No implicit stack engine
- No complex addressing modes

This version prioritizes **architectural consistency** over squeezing in every convenience instruction. A few operations that were previously given dedicated opcodes are now assembler pseudo-instructions.

---

## 2. Programmer's Model

### 2.1 Registers

COOLVM-16 has eight 16-bit integer registers:

| Register | Purpose |
|----------|---------|
| `r0`     | Hardwired zero. Reads return `0`; writes are discarded. |
| `r1`-`r5`| General purpose registers |
| `r6`     | Stack pointer (`SP`) by calling convention |
| `r7`     | Link register (`LR`) by calling convention |

`PC` is a separate 16-bit program counter and is not directly addressable as a GPR.

This keeps the encoding simple while avoiding a hidden dedicated stack register. `SP` and `LR` are ordinary architectural registers with conventional roles, similar to small real-world ISAs.

### 2.2 Memory Model

| Property       | Value |
|---------------|-------|
| Address space | 16-bit -> 64 KiB |
| Word size     | 16 bits |
| Byte addr.    | Yes |
| Endianness    | Little-endian |
| Alignment     | `LW`/`SW` require even addresses |
| I/O           | Memory-mapped |

Byte loads and stores are supported. Misaligned word access is architecturally defined to raise an alignment exception.

---

## 3. Instruction Encoding

All instructions are exactly 16 bits.

There are five primary encoding layouts selected by opcode:

```
Format R  (Register-Register ALU)
┌──────┬─────┬─────┬─────┬──────┐
│ op   │ rd  │ rs1 │ rs2 │ func │
│ 4b   │ 3b  │ 3b  │ 3b  │ 3b   │
└──────┴─────┴─────┴─────┴──────┘
 15:12  11:9   8:6   5:3   2:0

Format I  (Immediate ALU / shifts)
┌──────┬─────┬─────┬────────┐
│ op   │ rd  │ rs1 │ imm6   │
│ 4b   │ 3b  │ 3b  │ 6b     │
└──────┴─────┴─────┴────────┘
 15:12  11:9   8:6    5:0

Format M  (Memory)
┌──────┬─────┬─────┬────────┐
│ op   │ reg │ base│ imm6   │
│ 4b   │ 3b  │ 3b  │ 6b     │
└──────┴─────┴─────┴────────┘
 15:12  11:9   8:6    5:0

Format B  (Branch)
┌──────┬─────┬─────┬────────┐
│ op   │ rs1 │ rs2 │ imm6   │
│ 4b   │ 3b  │ 3b  │ 6b     │
└──────┴─────┴─────┴────────┘
 15:12  11:9   8:6    5:0

Format J  (PC-relative jump-and-link)
┌──────┬──────────────┐
│ op   │ imm12        │
│ 4b   │ 12b          │
└──────┴──────────────┘
 15:12     11:0
```

Immediate rules:
- `ADDI`, `SLLI`, `SRLI`, `SRAI`, loads/stores, and branches use a 6-bit immediate.
- `ADDI`, memory offsets, and branches **sign-extend** `imm6`.
- `ANDI`, `ORI`, and `XORI` **zero-extend** `imm6`.
- Branch and jump offsets are measured in bytes and are added to `PC + 2`, not the current `PC`.
- `BEQ`/`BNE` offsets are shifted left by 1 before addition, giving a branch range of `PC + 2 +/- 64` bytes.
- `JAL` offsets are shifted left by 1 before addition, giving a jump range of `PC + 2 +/- 4096` bytes.

---

## 4. Instruction Set

### 4.1 R-Format: Register ALU Operations (`op = 0x0`)

| func | Mnemonic | Operation |
|------|----------|-----------|
| 000  | `ADD  rd, rs1, rs2`  | `rd <- rs1 + rs2` |
| 001  | `SUB  rd, rs1, rs2`  | `rd <- rs1 - rs2` |
| 010  | `AND  rd, rs1, rs2`  | `rd <- rs1 & rs2` |
| 011  | `OR   rd, rs1, rs2`  | `rd <- rs1 \| rs2` |
| 100  | `XOR  rd, rs1, rs2`  | `rd <- rs1 ^ rs2` |
| 101  | `SLT  rd, rs1, rs2`  | `rd <- (rs1 < rs2) ? 1 : 0` (signed) |
| 110  | `SLTU rd, rs1, rs2`  | `rd <- (rs1 <u rs2) ? 1 : 0` |
| 111  | Special subgroup     | See below |

`func = 111` is reserved for non-ALU register-operand instructions. In v1.1, the defined special form is:

| Pattern | Mnemonic | Operation |
|---------|----------|-----------|
| `op=0000, rs2=111, func=111` | `JALR rd, rs1` | `rd <- PC + 2; PC <- rs1` |

All other `func=111` encodings are illegal instructions.

**Common pseudo-instructions**
```asm
MOV  rd, rs     -> ADD  rd, rs, r0
NEG  rd, rs     -> SUB  rd, r0, rs
NOT  rd, rs     -> XORI rd, rs, 0x3F   ; assembler emits the right mask sequence if needed
NOP             -> ADD  r0, r0, r0
RET             -> JALR r0, r7
JR   rs         -> JALR r0, rs
```

### 4.2 I-Format: Immediate ALU Operations

| op   | Mnemonic | Operation | Immediate treatment |
|------|----------|-----------|---------------------|
| 0001 | `ADDI rd, rs1, imm6` | `rd <- rs1 + sext(imm6)` | sign-extended |
| 0010 | `ANDI rd, rs1, imm6` | `rd <- rs1 & zext(imm6)` | zero-extended |
| 0011 | `ORI  rd, rs1, imm6` | `rd <- rs1 \| zext(imm6)` | zero-extended |
| 0100 | `XORI rd, rs1, imm6` | `rd <- rs1 ^ zext(imm6)` | zero-extended |
| 0101 | `SLLI rd, rs1, imm6` | `rd <- rs1 << imm6[3:0]` | low 4 bits used |
| 0110 | `SRLI rd, rs1, imm6` | `rd <- rs1 >> imm6[3:0]` | logical |
| 0111 | `SRAI rd, rs1, imm6` | `rd <- rs1 >>> imm6[3:0]` | arithmetic |

**Pseudo-instructions**
```asm
LI   rd, small  -> ADDI rd, r0, small        ; for -32..31
SUBI rd, rs, n  -> ADDI rd, rs, -n
SEQZ rd, rs     -> SLTIU is not a base instruction; assembler expands via:
                   SLTU rd, rs, r0
                   XORI rd, rd, 1
SNEZ rd, rs     -> SLTU rd, r0, rs
```

### 4.3 M-Format: Memory Operations

| op   | Mnemonic | Operation |
|------|----------|-----------|
| 1000 | `LW  rd, imm6(base)` | `rd <- mem16[base + sext(imm6)]` |
| 1001 | `SW  rs, imm6(base)` | `mem16[base + sext(imm6)] <- rs` |
| 1100 | `LB  rd, imm6(base)` | `rd <- sext(mem8[base + sext(imm6)])` |
| 1101 | `SB  rs, imm6(base)` | `mem8[base + sext(imm6)] <- rs[7:0]` |

For `LW`/`SW`, the effective address must be even or the CPU raises an alignment exception.

**Pseudo-instructions**
```asm
PUSH rs         -> ADDI r6, r6, -2
                   SW   rs, 0(r6)

POP  rd         -> LW   rd, 0(r6)
                   ADDI r6, r6, 2
```

### 4.4 B-Format: Compare-and-Branch

| op   | Mnemonic | Operation |
|------|----------|-----------|
| 1110 | `BEQ rs1, rs2, off` | if `rs1 == rs2`, `PC <- PC + 2 + (sext(off) << 1)` |
| 1111 | `BNE rs1, rs2, off` | if `rs1 != rs2`, `PC <- PC + 2 + (sext(off) << 1)` |

If the branch is not taken, execution continues at `PC + 2`.

**Derived branch idioms**
```asm
; Branch if r1 < r2 (signed)
SLT  r5, r1, r2
BNE  r5, r0, target

; Branch if r1 < r2 (unsigned)
SLTU r5, r1, r2
BNE  r5, r0, target

; Branch if r1 >= r2 (signed)
SLT  r5, r1, r2
BEQ  r5, r0, target

; Unconditional short branch
BEQ  r0, r0, target
```

### 4.5 J-Format: PC-Relative Jump and Call

| op   | Mnemonic | Operation |
|------|----------|-----------|
| 1010 | `JAL imm12` | `r7 <- PC + 2; PC <- PC + 2 + (sext(imm12) << 1)` |

**Pseudo-instructions**
```asm
CALL label      -> JAL label
JMP  label      -> JAL label        ; clobbers r7
```

Use `BEQ r0, r0, label` when a non-linking short jump is sufficient and preserving `r7` matters.

### 4.6 SYS-Format: System and CSR Instructions (`op = 0xB`)

The `SYS` major opcode uses this internal layout:

```
┌──────┬──────┬─────┬────────┐
│ op   │ sub  │ reg │ csr6   │
│ 4b   │ 3b   │ 3b  │ 6b     │
└──────┴──────┴─────┴────────┘
 15:12  11:9   8:6    5:0
```

| sub | Mnemonic | Meaning |
|-----|----------|---------|
| 000 | `ECALL`       | Environment call trap |
| 001 | `EBREAK`      | Debug trap |
| 010 | `ERET`        | Return from exception |
| 011 | `FENCE`       | Ordering fence; architectural no-op on a simple single-core implementation |
| 100 | `CSRR rd, csr`| `rd <- CSR[csr]` |
| 101 | `CSRW csr, rs`| `CSR[csr] <- rs` |
| 110 | Reserved      | Illegal instruction |
| 111 | Reserved      | Illegal instruction |

For `ECALL`, `EBREAK`, `ERET`, and `FENCE`, the `reg` and `csr6` fields must be zero. Non-zero encodings are illegal.

### 4.7 Loading Constants

COOLVM-16 intentionally does **not** include a dedicated full-width immediate instruction in the base ISA. That keeps opcode pressure manageable in a 16-bit encoding.

Small constants use `ADDI rd, r0, imm6`.

Arbitrary 16-bit constants are loaded via an assembler pseudo-instruction that emits a short shift/or sequence:

```asm
LI r1, 0xABCD  ->
    ADDI r1, r0, <top6>
    SLLI r1, r1, 6
    ORI  r1, r1, <mid6>
    SLLI r1, r1, 4
    ORI  r1, r1, <low4>
```

This is larger than a dedicated `LUI`, but it is correct for all 16-bit values and keeps the base encoding map consistent.

---

## 5. Calling Convention

| Register | Role | Saved by |
|----------|------|----------|
| `r0`     | Zero | - |
| `r1`     | Return value / scratch | Caller |
| `r2-r3`  | Arguments 1-2 / scratch | Caller |
| `r4-r5`  | Callee-saved | Callee |
| `r6`     | Stack pointer (`SP`) | Callee |
| `r7`     | Link register (`LR`) | Caller |

The stack grows downward and remains 2-byte aligned.

**Function call sequence**
```asm
; Caller side
ADDI r2, r0, 42
ADDI r3, r0, 7
JAL  my_function
; result in r1

; Callee side
my_function:
    ADDI r6, r6, -2
    SW   r7, 0(r6)
    ADDI r6, r6, -2
    SW   r4, 0(r6)
    ; ... body ...
    LW   r4, 0(r6)
    ADDI r6, r6, 2
    LW   r7, 0(r6)
    ADDI r6, r6, 2
    JALR r0, r7
```

---

## 6. Interrupt / Exception Model

COOLVM-16 has two privilege levels:
- `U` - User
- `S` - Supervisor

### 6.1 Supervisor CSRs

| CSR | Name | Purpose |
|-----|------|---------|
| 0x00 | `STATUS`  | Bit 0 = interrupt enable, bit 1 = privilege (`0=U`, `1=S`) |
| 0x01 | `ESTATUS` | Saved `STATUS` during trap entry |
| 0x02 | `EPC`     | PC to return to on `ERET` |
| 0x03 | `CAUSE`   | Trap cause code |
| 0x04 | `IVEC`    | Trap vector base address |

Additional CSR numbers are reserved.

### 6.2 Trap entry

On an exception or interrupt:
1. `EPC <- faulting PC` for synchronous exceptions, or the next PC for interrupts.
2. `ESTATUS <- STATUS`
3. `STATUS.IE <- 0`
4. `STATUS.PRIV <- S`
5. `PC <- IVEC + (CAUSE << 1)`

The vector stride is 2 bytes because instructions are 16-bit.

### 6.3 Trap return

`ERET` performs:
1. `PC <- EPC`
2. `STATUS <- ESTATUS`

`ERET` is legal only in supervisor mode. Executing it in user mode raises an illegal-instruction exception.

### 6.4 Privilege rules

- `ECALL` is legal in both user and supervisor mode.
- `EBREAK` is legal in both modes.
- `CSRW` to any supervisor CSR is legal only in supervisor mode.
- `CSRR` of supervisor CSRs is legal only in supervisor mode.
- `ERET` is supervisor-only.
- Attempting a privileged instruction or CSR access in user mode raises an illegal-instruction exception.

### 6.5 Required exception causes

Implementations must at minimum define causes for:
- Illegal instruction
- Misaligned `LW`/`SW`
- `ECALL` from user mode
- `ECALL` from supervisor mode
- Breakpoint (`EBREAK`)
- External interrupt

An implementation may define additional cause codes, but these base causes must be stable across emulator and hardware builds.

---

## 7. Full Opcode Map

```
 op    Format  Instruction
─────────────────────────────
0000    R      Register ALU / JALR special subgroup
0001    I      ADDI
0010    I      ANDI
0011    I      ORI
0100    I      XORI
0101    I      SLLI
0110    I      SRLI
0111    I      SRAI
1000    M      LW
1001    M      SW
1010    J      JAL
1011    SYS    ECALL / EBREAK / ERET / FENCE / CSRR / CSRW
1100    M      LB
1101    M      SB
1110    B      BEQ
1111    B      BNE
```

---

## 8. Example Program: Fibonacci

```asm
; Compute the 10th Fibonacci number
; Result in r1

        ADDI r2, r0, 0
        ADDI r1, r0, 1
        ADDI r3, r0, 10
        ADDI r4, r0, 0

loop:
        BEQ  r4, r3, done
        ADD  r5, r1, r2
        ADD  r2, r1, r0
        ADD  r1, r5, r0
        ADDI r4, r4, 1
        BEQ  r0, r0, loop

done:
        ECALL
```

---

## 9. Why Each Decision Matters

| Decision | Why |
|---|---|
| Fixed 16-bit instructions | Simple fetch and decode |
| `r0 = 0` | Eliminates many one-off opcodes |
| `SP` and `LR` are conventions, not hidden state | Keeps the ISA small and honest |
| No flags register | No hidden arithmetic side effects |
| `PC + 2`-relative control flow | Precise, unambiguous assembler semantics |
| `SLT`/`SLTU` in the base ISA | Enables derived signed and unsigned branches |
| `SYS` as a dedicated major opcode | Avoids collisions with ordinary ALU encodings |
| Explicit privilege rules | Same behavior in emulator and hardware |
| No base `LUI` | Saves opcode space in a tight 16-bit design |

---

## 10. What To Build Next

1. Assembler with pseudo-instruction expansion
2. Emulator with traps and privilege checks
3. Single-cycle CPU
4. Simple pipeline
5. Tiny supervisor runtime with `ECALL` handling

---

*COOLVM-16 v1.1 - designed for clarity, consistency, and teachability.*
