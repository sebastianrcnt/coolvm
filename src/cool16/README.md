# cool16 Assembly Guide

This guide is a practical reference for writing assembly for `cool16`.

It covers:

- The machine model
- The assembly syntax accepted by the current assembler
- Every base instruction family
- Supported pseudo-instructions
- Function calls, stack usage, and common control-flow patterns
- Running, assembling, and tracing programs with the CLI

For the architectural spec, see [specs/cool16.md](/Users/coolguy/dev/study/coolvm/src/specs/cool16.md).

## Overview

`cool16` is a small 16-bit load/store ISA with:

- 8 general registers: `r0` through `r7`
- 16-bit words
- 64 KiB address space
- Fixed 16-bit instructions
- Byte-addressed memory
- Little-endian word layout

The current toolchain in `src/cool16` includes:

- An assembler
- A VM / emulator
- A disassembler
- A CLI with `run`, `asm`, and `dis`

## Registers

`cool16` has 8 architectural integer registers:

| Register | Meaning |
|---|---|
| `r0` | hardwired zero |
| `r1` | general purpose / return value by convention |
| `r2` | general purpose / argument 1 by convention |
| `r3` | general purpose / argument 2 by convention |
| `r4` | general purpose / callee-saved by convention |
| `r5` | general purpose / callee-saved by convention |
| `r6` | stack pointer |
| `r7` | link register / return address |

Assembler aliases:

- `sp` = `r6`
- `lr` = `r7`

Important rule:

- Writes to `r0` are ignored.
- Reads from `r0` always produce `0`.

## Memory Model

- Address space: `0x0000` to `0xFFFF`
- Word size: 16 bits
- Memory is byte-addressed
- Words are little-endian
- `LW` and `SW` require even addresses
- `LB` and `SB` may use any address

Misaligned `LW` and `SW` trap.

## Source File Syntax

The assembler is intentionally simple.

### Comments

Comments begin with `;`.

```asm
ADDI r1, r0, 5   ; load 5
```

### Labels

Labels end with `:`.

```asm
start:
    ADDI r1, r0, 1
```

You can put a label on its own line or before an instruction on the same line.

```asm
loop: ADDI r1, r1, 1
```

### Instruction Format

Arguments are comma-separated.

```asm
ADD  r1, r2, r3
ADDI r1, r2, -5
LW   r1, 0(r2)
BEQ  r1, r2, done
```

### Integer Literals

The assembler accepts:

- Decimal: `42`, `-5`
- Hex: `0x2A`
- Binary: `0b101010`

Examples:

```asm
ADDI r1, r0, 31
ADDI r2, r0, -1
ORI  r3, r0, 0x3F
ADDI r4, r0, 0b1010
```

### Things the Current Assembler Does Not Support

The current assembler does not implement:

- `.data`, `.text`, `.word`, `.byte`, or other directives
- String literals
- Expressions like `label + 4`
- Arithmetic in immediates like `0x1234 & 0x1F`

If you need data, place it in memory manually from code using stores.

## Instruction Set

## Register-Register ALU

These operate on registers only.

### `ADD rd, rs1, rs2`

```asm
ADD r1, r2, r3
```

Effect:

```text
r1 = r2 + r3
```

### `SUB rd, rs1, rs2`

```asm
SUB r1, r2, r3
```

Effect:

```text
r1 = r2 - r3
```

Arithmetic wraps modulo 16 bits.

### `AND rd, rs1, rs2`

Bitwise AND.

### `OR rd, rs1, rs2`

Bitwise OR.

### `XOR rd, rs1, rs2`

Bitwise XOR.

### `SLT rd, rs1, rs2`

Signed comparison.

Sets `rd` to `1` if `rs1 < rs2`, else `0`.

### `SLTU rd, rs1, rs2`

Unsigned comparison.

Sets `rd` to `1` if `rs1 < rs2`, else `0`.

### `JALR rd, rs1`

Indirect jump and link.

```asm
JALR r7, r2
```

Effect:

```text
rd = PC + 2
PC = rs1
```

Typical uses:

- Returning from a function
- Jumping through a function pointer
- Building trampolines or dispatch tables

## Immediate ALU Instructions

## `ADDI rd, rs1, imm6`

Adds a signed 6-bit immediate.

Range:

- `-32` to `31` in the architectural encoding

Examples:

```asm
ADDI r1, r0, 5
ADDI r2, r2, -1
ADDI sp, sp, -2
```

## `ANDI rd, rs1, imm6`

Bitwise AND with a zero-extended immediate.

```asm
ANDI r1, r1, 0x3F
```

## `ORI rd, rs1, imm6`

Bitwise OR with a zero-extended immediate.

```asm
ORI r1, r1, 0x0F
```

## `XORI rd, rs1, imm6`

Bitwise XOR with a zero-extended immediate.

```asm
XORI r1, r1, 1
```

## Shift Instructions

### `SLLI rd, rs1, imm6`

Logical left shift.

Only the low 4 bits of the immediate are used as the shift amount.

```asm
SLLI r1, r1, 4
```

### `SRLI rd, rs1, imm6`

Logical right shift.

```asm
SRLI r1, r1, 8
```

### `SRAI rd, rs1, imm6`

Arithmetic right shift.

```asm
SRAI r1, r1, 2
```

## Memory Instructions

## `LW rd, off(base)`

Load a 16-bit word from memory.

```asm
LW r1, 0(sp)
LW r2, 4(r3)
```

Rules:

- Effective address = `base + signed offset`
- Address must be even

## `SW rs, off(base)`

Store a 16-bit word to memory.

```asm
SW r1, 0(sp)
SW r2, 4(r3)
```

Rules:

- Effective address = `base + signed offset`
- Address must be even

## `LB rd, off(base)`

Load a byte and sign-extend it to 16 bits.

```asm
LB r1, 0(r2)
```

If the byte in memory is `0x80`, the result is `0xFF80`.

## `SB rs, off(base)`

Store the low 8 bits of `rs`.

```asm
SB r1, 1(r2)
```

## Branches

## `BEQ rs1, rs2, target`

Branch if equal.

```asm
BEQ r1, r2, done
```

## `BNE rs1, rs2, target`

Branch if not equal.

```asm
BNE r1, r2, loop
```

Branch targets may be:

- A label
- A raw immediate offset

In normal code, use labels.

### Important Branch Rule

Branches are relative to `PC + 2`, not the current `PC`.

The assembler handles this automatically for labels.

### Unconditional Short Jump

Use:

```asm
BEQ r0, r0, target
```

This preserves `r7`, unlike `JMP`.

## Jumps and Calls

## `JAL target`

Jump and link.

```asm
JAL func
```

Effect:

```text
r7 = PC + 2
PC = target
```

Use it for function calls.

## System Instructions

## `ECALL`

Raises an environment call trap.

In the current CLI runner, the VM’s default `ECALL` handler halts execution.

That means simple programs usually end with:

```asm
ECALL
```

## `EBREAK`

Raises a breakpoint trap.

## `ERET`

Return from an exception.

Normally only used by trap handlers in supervisor mode.

## `FENCE`

Architectural no-op in the current simple VM.

## `CSRR rd, csr`

Read a CSR into a register.

```asm
CSRR r1, 0x04
```

## `CSRW csr, rs`

Write a register to a CSR.

```asm
CSRW 0x04, r1
```

These are privileged operations in the machine model.

## Supported Pseudo-Instructions

These are assembler conveniences. They expand into one or more base instructions.

## `NOP`

Does nothing.

```asm
NOP
```

Equivalent to:

```asm
ADD r0, r0, r0
```

## `MOV rd, rs`

Copy a register.

```asm
MOV r2, r1
```

Equivalent to:

```asm
ADD r2, r1, r0
```

## `NEG rd, rs`

Two’s-complement negate.

```asm
NEG r2, r1
```

Equivalent to:

```asm
SUB r2, r0, r1
```

## `NOT rd, rs`

Bitwise invert all 16 bits.

```asm
NOT r2, r1
```

The current assembler expands this as a short sequence, not a single base instruction.

## `RET`

Return from a function.

```asm
RET
```

Equivalent to:

```asm
JALR r0, r7
```

## `JR rs`

Jump to a register without linking.

```asm
JR r2
```

Equivalent to:

```asm
JALR r0, r2
```

## `LI rd, imm`

Load an integer constant.

```asm
LI r1, 15
LI r2, 0xABCD
```

Behavior:

- Small values in `-32..31` assemble as one `ADDI`
- Larger 16-bit values expand to a multi-instruction sequence

This is the preferred way to load constants.

## `SUBI rd, rs, imm`

Subtract an immediate.

```asm
SUBI r1, r1, 1
```

Equivalent to:

```asm
ADDI r1, r1, -1
```

## `SEQZ rd, rs`

Set if equal to zero.

```asm
SEQZ r2, r1
```

Result:

- `r2 = 1` if `r1 == 0`
- `r2 = 0` otherwise

## `SNEZ rd, rs`

Set if not equal to zero.

```asm
SNEZ r2, r1
```

Result:

- `r2 = 1` if `r1 != 0`
- `r2 = 0` otherwise

## `PUSH rs`

Push a word on the stack.

```asm
PUSH r1
```

Equivalent to:

```asm
ADDI sp, sp, -2
SW   r1, 0(sp)
```

## `POP rd`

Pop a word from the stack.

```asm
POP r1
```

Equivalent to:

```asm
LW   r1, 0(sp)
ADDI sp, sp, 2
```

## `CALL label`

Pseudo for `JAL`.

```asm
CALL func
```

## `JMP label`

Pseudo for `JAL`.

```asm
JMP somewhere
```

Important:

- `JMP` clobbers `r7`
- Prefer `BEQ r0, r0, label` for short unconditional jumps when preserving `r7` matters

## Arithmetic and Boolean Patterns

## Add Two Numbers

```asm
ADD r1, r2, r3
```

## Subtract One

```asm
SUBI r1, r1, 1
```

## Multiply by 16

```asm
SLLI r1, r1, 4
```

## Test for Zero

```asm
SEQZ r2, r1
```

## Test for Nonzero

```asm
SNEZ r2, r1
```

## Branching Patterns

## If / Else

```asm
    ; if (r1 == r2) goto equal
    BEQ r1, r2, equal

    ; else path
    ADDI r3, r0, 0
    BEQ  r0, r0, done

equal:
    ADDI r3, r0, 1

done:
    ECALL
```

## Counted Loop

```asm
    ADDI r1, r0, 0      ; i = 0
    ADDI r2, r0, 10     ; limit = 10

loop:
    BEQ  r1, r2, done
    ADDI r1, r1, 1
    BEQ  r0, r0, loop

done:
    ECALL
```

## Signed Less-Than Branch

There is no direct `BLT`. Build it with `SLT` + branch.

```asm
    SLT  r5, r1, r2
    BNE  r5, r0, less
```

## Unsigned Less-Than Branch

```asm
    SLTU r5, r1, r2
    BNE  r5, r0, less
```

## Functions and Calling Convention

The conventional calling convention is:

| Register | Role |
|---|---|
| `r1` | return value |
| `r2`, `r3` | arguments / caller-saved |
| `r4`, `r5` | callee-saved |
| `sp` / `r6` | stack pointer |
| `lr` / `r7` | link register |

### Simple Leaf Function

```asm
    ADDI r2, r0, 3
    CALL double
    ECALL

double:
    ADD  r1, r2, r2
    RET
```

### Function with Stack Save/Restore

```asm
    LI   sp, 0x0040
    ADDI r2, r0, 3
    CALL double
    ECALL

double:
    PUSH lr
    ADD  r1, r2, r2
    POP  lr
    RET
```

### Saving Callee-Saved Registers

If your function modifies `r4` or `r5`, save and restore them.

```asm
func:
    PUSH lr
    PUSH r4

    ; body
    ADDI r4, r0, 1

    POP  r4
    POP  lr
    RET
```

## Working with Memory

Because there are no data directives yet, most examples build state in memory manually.

### Store and Reload a Word

```asm
    LI   r1, 0x1234
    LI   r2, 0x0020
    SW   r1, 0(r2)
    LW   r3, 0(r2)
    ECALL
```

### Store and Reload a Byte

```asm
    ADDI r1, r0, 25
    LI   r2, 0x0020
    SB   r1, 0(r2)
    LB   r3, 0(r2)
    ECALL
```

## Complete Example: Fibonacci

```asm
        ADDI r2, r0, 0
        ADDI r1, r0, 1
        ADDI r3, r0, 10
        ADDI r4, r0, 0

loop:
        BEQ  r4, r3, done
        ADD  r5, r1, r2
        MOV  r2, r1
        MOV  r1, r5
        ADDI r4, r4, 1
        BEQ  r0, r0, loop

done:
        ECALL
```

After execution, `r1` contains `89`.

## Running Programs

Use the CLI in `src/cool16/cli.ts`.

## Run a Program

```bash
bun run src/cool16/cli.ts run program.asm
```

## Run with Trace Output

```bash
bun run src/cool16/cli.ts run --trace program.asm
```

This prints:

- The address
- The raw instruction word
- The disassembled instruction

## Assemble to Hex Listing

```bash
bun run src/cool16/cli.ts asm program.asm
```

## Disassemble a Binary File

```bash
bun run src/cool16/cli.ts dis program.bin
```

## Debugging Tips

## Start Small

Write tiny programs first:

- load a constant
- do one arithmetic instruction
- branch once
- terminate with `ECALL`

## End Test Programs with `ECALL`

The CLI runner treats `ECALL` as the normal stop instruction for small user programs.

## Prefer `LI` for Constants

Use `LI` instead of hand-rolling constant-load sequences unless you are studying encodings.

## Use `MOV` for Clarity

These are equivalent:

```asm
MOV r2, r1
ADD r2, r1, r0
```

`MOV` is clearer.

## Be Careful with `JMP`

`JMP` is implemented as `JAL`, so it overwrites `lr`.

If you want an unconditional branch and need to preserve `lr`, use:

```asm
BEQ r0, r0, target
```

## Keep the Stack Aligned

Push and pop words in 2-byte units:

- subtract `2` when pushing
- add `2` when popping

## Common Mistakes

## Using Odd Addresses with `LW` or `SW`

This traps.

Bad:

```asm
ADDI r2, r0, 0x21
LW   r1, 0(r2)
```

## Expecting `r0` to Change

This does not work:

```asm
ADDI r0, r0, 5
```

`r0` remains zero.

## Forgetting That `LB` Sign-Extends

`LB` loads signed bytes. If you need to reason about raw byte values, remember that `0x80` becomes `0xFF80`.

## Forgetting That Branches and Jumps Are PC-Relative

Use labels. Let the assembler compute the offsets.

## Expecting Data Directives

Right now, the assembler is code-only. There is no `.word` or `.byte` support yet.

## Quick Reference

### Base instructions

```text
ADD   SUB   AND   OR    XOR   SLT   SLTU   JALR
ADDI  ANDI  ORI   XORI  SLLI  SRLI  SRAI
LW    SW    LB    SB
BEQ   BNE
JAL
ECALL EBREAK ERET FENCE CSRR CSRW
```

### Supported pseudo-instructions

```text
NOP   MOV   NEG   NOT   RET   JR
LI    SUBI  SEQZ  SNEZ
PUSH  POP
CALL  JMP
```

### Register aliases

```text
sp = r6
lr = r7
```

## Recommended Style

- Use labels for all control flow
- Use `LI` for constants
- Use `MOV` / `RET` / `PUSH` / `POP` for readability
- Preserve `lr` in non-leaf functions
- Preserve `r4` and `r5` in callees if you modify them
- End standalone programs with `ECALL`

That is enough to write real programs in `cool16` assembly today.
