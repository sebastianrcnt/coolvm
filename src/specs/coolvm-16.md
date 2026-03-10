# COOLVM-16: A Clean 16-Bit Educational CPU Architecture

> *"What if we designed a 16-bit CPU in 2026, knowing everything we know now?"*

---

## 1. Design Philosophy

COOLVM-16 is a 16-bit RISC processor designed for education. It reflects modern CPU design principles — load/store architecture, fixed-width instructions, no implicit state, orthogonal encoding — while being small enough to implement on an FPGA or simulate in software.

**What we kept from modern CPUs:**
- Fixed-width 16-bit instructions (like ARM Thumb / RISC-V compressed)
- Load/Store architecture (like ARM, RISC-V, MIPS)
- Uniform general-purpose register file (like RISC-V)
- Compare-and-branch (like RISC-V — no flags register)
- PC-relative addressing for position-independent code
- Lots of orthogonality — every register is interchangeable

**What we intentionally omit (legacy baggage):**
- ❌ No condition flags register (EFLAGS/NZCV)
- ❌ No accumulator or special-purpose registers
- ❌ No segment registers
- ❌ No variable-length encoding
- ❌ No string instructions or BCD
- ❌ No complex addressing modes
- ❌ No delay slots

---

## 2. Programmer's Model

### 2.1 Registers

```
┌─────────────────────────────────────────────┐
│  General Purpose Registers (16-bit each)    │
├──────────┬──────────────────────────────────┤
│  r0      │  Hardwired zero (reads 0, writes │
│          │  are discarded) — like RISC-V x0 │
│  r1–r6   │  General purpose                 │
│  r7      │  Link register (set by CALL)     │
├──────────┼──────────────────────────────────┤
│  Special Registers                          │
├──────────┼──────────────────────────────────┤
│  PC      │  Program counter (not directly   │
│          │  addressable; manipulated via     │
│          │  branches and CALL/RET)           │
│  SP      │  Stack pointer (dedicated,       │
│          │  accessed via PUSH/POP/SP-rel     │
│          │  load/store)                      │
└──────────┴──────────────────────────────────┘
```

**Why r0 = zero?** It's one of the best ideas in RISC design. With a zero register:
- `ADD r1, r2, r0` → MOV r1, r2 (no separate MOV opcode needed)
- `SUB r0, r0, r0` → NOP
- `SLT r1, r0, r2` → test if r2 > 0
- Comparisons, negation, and zero-initialization are all free.

**Why a dedicated SP?** In a 16-bit world with only 8 registers, burning a GPR for the stack pointer is too expensive. A dedicated SP gives us the full 8 GPRs while still supporting fast function calls.

### 2.2 Memory Model

| Property       | Value                             |
|---------------|-----------------------------------|
| Address space | 16-bit → 64 KiB                  |
| Word size     | 16 bits                           |
| Byte addr.    | Yes (byte-addressable)            |
| Alignment     | Word loads/stores must be aligned |
| Endianness    | Little-endian                     |
| I/O           | Memory-mapped (no special I/O instructions) |

---

## 3. Instruction Encoding

All instructions are exactly 16 bits. No exceptions. No prefixes. No extensions.

There are **5 encoding formats**, each cleanly delineated by the top bits:

```
Format R  (Register-Register):   3-operand ALU
┌──────┬─────┬─────┬─────┬──────┐
│ op   │ rd  │ rs1 │ rs2 │ func │
│ 4b   │ 3b  │ 3b  │ 3b  │ 3b   │
└──────┴─────┴─────┴─────┴──────┘
 15:12  11:9   8:6   5:3   2:0

Format I  (Immediate):   ALU with small constant
┌──────┬─────┬─────┬────────┐
│ op   │ rd  │ rs1 │ imm6   │
│ 4b   │ 3b  │ 3b  │ 6b     │
└──────┴─────┴─────┴────────┘
 15:12  11:9   8:6    5:0
 (imm6 is sign-extended to 16 bits)

Format M  (Memory):   Load/Store with offset
┌──────┬─────┬─────┬────────┐
│ op   │ rd  │ rs1 │ imm6   │
│ 4b   │ 3b  │ 3b  │ 6b     │
└──────┴─────┴─────┴────────┘
 15:12  11:9   8:6    5:0
 (Same layout as I-format, but op determines load vs store)

Format B  (Branch):   Compare-and-branch
┌──────┬─────┬─────┬────────┐
│ op   │ rs1 │ rs2 │ imm6   │
│ 4b   │ 3b  │ 3b  │ 6b     │
└──────┴─────┴─────┴────────┘
 15:12  11:9   8:6    5:0
 (imm6 is sign-extended, shifted left 1, added to PC)
 Branch range: PC ± 126 bytes

Format J  (Jump):   Long jump / call
┌──────┬──────────────┐
│ op   │ imm12        │
│ 4b   │ 12b          │
└──────┴──────────────┘
 15:12     11:0
 (imm12 is sign-extended, shifted left 1, added to PC)
 Jump range: PC ± 4094 bytes
```

---

## 4. Instruction Set

### 4.1 R-Format: Register ALU Operations (op = 0x0)

The `op` field is `0000`. The `func` field selects the operation:

| func | Mnemonic          | Operation               | Notes                        |
|------|-------------------|-------------------------|------------------------------|
| 000  | `ADD rd, rs1, rs2`  | rd ← rs1 + rs2         |                              |
| 001  | `SUB rd, rs1, rs2`  | rd ← rs1 − rs2         |                              |
| 010  | `AND rd, rs1, rs2`  | rd ← rs1 & rs2         |                              |
| 011  | `OR  rd, rs1, rs2`  | rd ← rs1 \| rs2        |                              |
| 100  | `XOR rd, rs1, rs2`  | rd ← rs1 ^ rs2         |                              |
| 101  | `SLL rd, rs1, rs2`  | rd ← rs1 << rs2[3:0]   | Shift left logical           |
| 110  | `SRL rd, rs1, rs2`  | rd ← rs1 >> rs2[3:0]   | Shift right logical (zero-fill) |
| 111  | `SRA rd, rs1, rs2`  | rd ← rs1 >>> rs2[3:0]  | Shift right arithmetic (sign-fill) |

**Synthesized pseudo-instructions from R-format:**
```
MOV  rd, rs     →  ADD rd, rs, r0
NEG  rd, rs     →  SUB rd, r0, rs
NOP             →  ADD r0, r0, r0
NOT  rd, rs     →  XOR rd, rs, r0   (after LI r0... wait, r0 is zero!)
                    — Actually: use XORI rd, rs, -1  (I-format)
```

### 4.2 I-Format: Immediate ALU Operations

| op   | Mnemonic            | Operation                | Notes                  |
|------|---------------------|--------------------------|------------------------|
| 0001 | `ADDI rd, rs1, imm6` | rd ← rs1 + sext(imm6)  | Add immediate          |
| 0010 | `ANDI rd, rs1, imm6` | rd ← rs1 & sext(imm6)  | AND immediate          |
| 0011 | `ORI  rd, rs1, imm6` | rd ← rs1 \| sext(imm6) | OR immediate           |
| 0100 | `XORI rd, rs1, imm6` | rd ← rs1 ^ sext(imm6)  | XOR immediate          |
| 0101 | `SLTI rd, rs1, imm6` | rd ← (rs1 < sext(imm6)) ? 1 : 0 | Set if less than (signed) |
| 0110 | `SLTIU rd, rs1, imm6`| rd ← (rs1 <ᵤ sext(imm6)) ? 1 : 0 | Set if less than (unsigned) |
| 0111 | `LUI  rd, imm6`     | rd ← imm6 << 10         | Load upper immediate (see §4.7) |

**Synthesized pseudo-instructions from I-format:**
```
LI   rd, small  →  ADDI rd, r0, small       (for -32..+31)
NOT  rd, rs     →  XORI rd, rs, -1
SUBI rd, rs, n  →  ADDI rd, rs, -n
SEQZ rd, rs     →  SLTIU rd, rs, 1          (rd = 1 if rs == 0)
SNEZ rd, rs     →  SLTU rd, r0, rs          (via R-format SLT variant)
```

### 4.3 M-Format: Memory Operations

| op   | Mnemonic            | Operation                           |
|------|---------------------|-------------------------------------|
| 1000 | `LW  rd, imm6(rs1)` | rd ← mem[rs1 + sext(imm6)]  (16b) |
| 1001 | `SW  rs2, imm6(rs1)`| mem[rs1 + sext(imm6)] ← rs2 (16b) |
| 1010 | `LB  rd, imm6(rs1)` | rd ← sext(mem[rs1 + sext(imm6)]) (8b) |
| 1011 | `SB  rs2, imm6(rs1)`| mem[rs1 + sext(imm6)] ← rs2[7:0]  |

Note: In `SW` and `SB`, the field labeled `rd` in the encoding is actually used as `rs2` (the source register). The assembler handles this transparently.

**Stack operations (dedicated SP-relative):**

| op   | Mnemonic          | Operation                            |
|------|--------------------|--------------------------------------|
| 1100 | `PUSH rd`          | SP ← SP − 2; mem[SP] ← rd          |
| 1101 | `POP  rd`          | rd ← mem[SP]; SP ← SP + 2          |

PUSH/POP use the remaining bits for future extension (e.g., multi-register push).

### 4.4 B-Format: Compare-and-Branch

| op   | Mnemonic            | Operation                                |
|------|---------------------|------------------------------------------|
| 1110 | `BEQ rs1, rs2, off` | if rs1 == rs2: PC ← PC + sext(off)<<1  |
| 1111 | `BNE rs1, rs2, off` | if rs1 ≠ rs2:  PC ← PC + sext(off)<<1  |

**Wait — only BEQ and BNE? What about BLT, BGE, etc.?**

We use a two-instruction idiom with SLT:
```
; Branch if r1 < r2 (signed):
SLT  r5, r1, r2       ; r5 = 1 if r1 < r2
BNE  r5, r0, target    ; branch if r5 ≠ 0

; Branch if r1 >= r2 (signed):
SLT  r5, r1, r2
BEQ  r5, r0, target

; Branch if r1 == 0:
BEQ  r1, r0, target

; Unconditional branch:
BEQ  r0, r0, target    ; always taken (r0 == r0)
```

This is the RISC-V approach: fewer branch opcodes, same expressiveness, simpler hardware.

### 4.5 J-Format: Jumps and Calls

| op   | Encoding variant | Mnemonic       | Operation                              |
|------|-----------------|----------------|----------------------------------------|
| —    | J-format        | `JAL imm12`    | r7 ← PC + 2; PC ← PC + sext(imm12)<<1 |
| —    | R-format special| `JALR rd, rs1` | rd ← PC + 2; PC ← rs1                 |

- `JAL` is the primary call instruction. It saves return address in r7 (link register) and does a PC-relative jump.
- `JALR` enables indirect jumps: function pointers, vtable dispatch, return from call, long jumps via register.

**Pseudo-instructions:**
```
CALL label      →  JAL label          (saves return in r7)
RET             →  JALR r0, r7        (jump to r7, discard link)
JMP  label      →  JAL label          (ignore saved r7 if not needed)
                    or BEQ r0, r0, label (for short jumps)
JR   rs         →  JALR r0, rs        (indirect jump)
```

### 4.6 System / Special

We reserve opcode space for a small set of system operations, encoded as R-format with op=0x0 and special func patterns (rd=0, rs1=0, rs2=0 with func bits repurposed):

| Instruction | Encoding             | Description                          |
|-------------|----------------------|--------------------------------------|
| `ECALL`     | `0x0000`             | Environment call (syscall trap)      |
| `EBREAK`    | `0x0001`             | Breakpoint (debugger trap)           |
| `FENCE`     | `0x0002`             | Memory ordering fence                |

These follow RISC-V's model exactly: ECALL to request OS services, EBREAK for debugger integration.

### 4.7 Loading Large Constants

With only 6-bit immediates, how do we load a full 16-bit constant?

**LUI + ADDI pair** (inspired by RISC-V):

`LUI rd, imm6` loads `imm6` into bits [15:10] of rd, zeroing the rest.
Then `ADDI rd, rd, imm6` fills in the low bits.

```
; Load 0xABCD into r1:
;   0xABCD = 0b 1010_1011_11 | 00_1101
;                upper 6      lower 6 (but we need sign correction)

; Actually, the assembler computes this for you:
LI r1, 0xABCD    →   LUI  r1, <upper6>
                      ADDI r1, r1, <lower6_corrected>
```

The assembler handles the sign-extension correction automatically (same as RISC-V's `lui`/`addi` pair).

---

## 5. Calling Convention

Clean, simple, no legacy weirdness:

| Register | Role            | Caller-saved? |
|----------|-----------------|---------------|
| r0       | Zero            | —             |
| r1       | Return value    | Caller-saved  |
| r2–r3    | Arguments 1–2   | Caller-saved  |
| r4–r6    | Callee-saved    | Callee-saved  |
| r7       | Link register   | Caller-saved  |
| SP       | Stack pointer   | Callee-saved  |

**Function call sequence:**
```asm
; Caller side:
ADDI r2, r0, 42        ; arg1 = 42
ADDI r3, r0, 7         ; arg2 = 7
JAL  my_function        ; call (r7 ← return address)
; result in r1

; Callee side (my_function):
my_function:
    PUSH r7             ; save return address (if we call others)
    PUSH r4             ; save callee-saved regs we use
    ; ... function body ...
    ; put result in r1
    POP  r4
    POP  r7
    JALR r0, r7         ; return
```

---

## 6. Interrupt / Exception Model

Minimal but correct — reflecting how modern CPUs actually handle this:

```
┌────────────────────────────────────────────────────────┐
│  Control Registers (accessed via special instructions)  │
├──────────┬─────────────────────────────────────────────┤
│ IVEC     │ Interrupt vector base address               │
│ CAUSE    │ Exception cause code                        │
│ EPC      │ Saved PC on exception                       │
│ ESTATUS  │ Saved status on exception                   │
│ STATUS   │ Interrupt enable, privilege level (U/S)     │
└──────────┴─────────────────────────────────────────────┘

Exception flow:
  1. Hardware saves PC → EPC, STATUS → ESTATUS
  2. Hardware disables interrupts (STATUS.IE ← 0)
  3. PC ← IVEC + (CAUSE << 2)    ; vectored dispatch
  4. Handler executes, ends with ERET
  5. ERET restores: PC ← EPC, STATUS ← ESTATUS
```

Two privilege levels: **User** and **Supervisor**. Simple, no ring nonsense.

CSR (Control/Status Register) access via:
```
CSRR rd, csr       ; rd ← csr
CSRW csr, rs       ; csr ← rs
```
(Encoded using reserved R-format slots)

---

## 7. Full Opcode Map

```
 op    Format  Instruction
─────────────────────────────
0000    R      ALU register-register (func selects ADD/SUB/AND/OR/XOR/SLL/SRL/SRA)
0001    I      ADDI
0010    I      ANDI
0011    I      ORI
0100    I      XORI
0101    I      SLTI
0110    I      SLTIU
0111    I      LUI
1000    M      LW  (load word)
1001    M      SW  (store word)
1010    M      LB  (load byte)
1011    M      SB  (store byte)
1100    S      PUSH
1101    S      POP
1110    B      BEQ
1111    B      BNE

System instructions (ECALL, EBREAK, FENCE, CSRR, CSRW, ERET, JALR)
are encoded within the R-format space using reserved bit patterns.
JAL uses a dedicated encoding carved from the system space.
```

---

## 8. Example Program: Fibonacci

```asm
; Compute 10th Fibonacci number
; Result in r1

        LI   r2, 0          ; ADDI r2, r0, 0    — fib(0)
        LI   r1, 1          ; ADDI r1, r0, 1    — fib(1)
        LI   r3, 10         ; ADDI r3, r0, 10   — counter
        LI   r4, 0          ; ADDI r4, r0, 0    — loop index

loop:
        BEQ  r4, r3, done   ; if index == 10, done
        ADD  r5, r1, r2     ; next = a + b
        ADD  r2, r1, r0     ; b = a       (MOV r2, r1)
        ADD  r1, r5, r0     ; a = next    (MOV r1, r5)
        ADDI r4, r4, 1      ; index++
        BEQ  r0, r0, loop   ; unconditional branch (always jump)

done:
        ECALL                ; return to OS (r1 = result)
```

---

## 9. Why Each Decision Matters

| Decision | Why | Modern CPU that does this |
|---|---|---|
| Fixed 16-bit instructions | Simple fetch, no length decoding | ARM Thumb, RISC-V C |
| r0 = zero | Eliminates many pseudo-ops, simplifies hardware | RISC-V, MIPS |
| No flags register | No hidden state, no flag-setting side effects, easier OoO | RISC-V, MIPS |
| Compare-and-branch | One instruction instead of CMP+Bcc, no flag dependency chain | RISC-V |
| Load/Store only | Memory access is explicit; ALU only touches registers | ARM, RISC-V, MIPS |
| LUI+ADDI for constants | No variable-length immediates, clean 2-instruction idiom | RISC-V |
| Dedicated link register | Hardware knows where return address is; enables return prediction | ARM, RISC-V |
| ECALL for syscalls | Clean, minimal privilege transition; no INT 0x80 legacy | RISC-V |
| Memory-mapped I/O | No separate I/O address space or IN/OUT instructions | ARM, RISC-V |
| Little-endian fixed | No bi-endian complexity | Modern ARM (LE default), RISC-V |

---

## 10. What To Build Next

If you're implementing this as a learning project, here's a suggested progression:

1. **Assembler** — Write a simple 2-pass assembler (Python is perfect)
2. **Emulator** — Software simulator with step/trace/breakpoint
3. **Single-cycle CPU** — Verilog/VHDL on FPGA (this ISA maps beautifully to a single-cycle datapath)
4. **Pipelined CPU** — 5-stage pipeline (IF → ID → EX → MEM → WB), handle hazards
5. **Simple OS** — Trap handler, basic syscalls, context switching between two processes

Each stage teaches fundamental concepts that directly transfer to understanding real ARM/RISC-V processors.

---

*COOLVM-16 v1.0 — Designed for clarity, not compatibility.*
