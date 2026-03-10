import { test, expect, describe } from "bun:test";
import { Cool16, Csr, Cause } from "./core";
import { assemble } from "./assembler";

/** Helper: assemble source, load into a fresh VM, return the VM. */
function vm(source: string): Cool16 {
  const result = assemble(source);
  if (result.errors.length > 0) {
    throw new Error(result.errors.map((e) => `line ${e.line}: ${e.message}`).join("\n"));
  }
  const cpu = new Cool16();
  cpu.load(result.program);
  cpu.onEcall = (v) => { v.halted = true; };
  return cpu;
}

// ---------------------------------------------------------------------------
// Register file
// ---------------------------------------------------------------------------

describe("register file", () => {
  test("r0 is always zero", () => {
    const cpu = vm(`
      ADDI r1, r0, 5
      ADD  r0, r1, r1
      ECALL
    `);
    cpu.run();
    expect(cpu.regs[0]).toBe(0);
    expect(cpu.regs[1]).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// R-format ALU
// ---------------------------------------------------------------------------

describe("R-format ALU", () => {
  test("ADD", () => {
    const cpu = vm(`
      ADDI r1, r0, 3
      ADDI r2, r0, 7
      ADD  r3, r1, r2
      ECALL
    `);
    cpu.run();
    expect(cpu.regs[3]).toBe(10);
  });

  test("SUB", () => {
    const cpu = vm(`
      ADDI r1, r0, 10
      ADDI r2, r0, 4
      SUB  r3, r1, r2
      ECALL
    `);
    cpu.run();
    expect(cpu.regs[3]).toBe(6);
  });

  test("SUB underflow wraps to u16", () => {
    const cpu = vm(`
      ADDI r1, r0, 1
      ADDI r2, r0, 3
      SUB  r3, r1, r2
      ECALL
    `);
    cpu.run();
    expect(cpu.regs[3]).toBe(0xFFFE); // -2 as u16
  });

  test("AND", () => {
    const cpu = vm(`
      ADDI r1, r0, 0x1F
      ADDI r2, r0, 0x0F
      AND  r3, r1, r2
      ECALL
    `);
    cpu.run();
    expect(cpu.regs[3]).toBe(0x0F);
  });

  test("OR", () => {
    const cpu = vm(`
      ADDI r1, r0, 0x0A
      ADDI r2, r0, 0x05
      OR   r3, r1, r2
      ECALL
    `);
    cpu.run();
    expect(cpu.regs[3]).toBe(0x0F);
  });

  test("XOR", () => {
    const cpu = vm(`
      ADDI r1, r0, 0x0F
      ADDI r2, r0, 0x03
      XOR  r3, r1, r2
      ECALL
    `);
    cpu.run();
    expect(cpu.regs[3]).toBe(0x0C);
  });

  test("SLT signed comparison", () => {
    const cpu = vm(`
      ADDI r1, r0, -1
      ADDI r2, r0, 1
      SLT  r3, r1, r2
      SLT  r4, r2, r1
      ECALL
    `);
    cpu.run();
    expect(cpu.regs[3]).toBe(1); // -1 < 1
    expect(cpu.regs[4]).toBe(0); // 1 < -1 is false
  });

  test("SLTU unsigned comparison", () => {
    const cpu = vm(`
      ADDI r1, r0, 1
      ADDI r2, r0, -1
      SLTU r3, r1, r2
      SLTU r4, r2, r1
      ECALL
    `);
    cpu.run();
    expect(cpu.regs[3]).toBe(1); // 1 <u 0xFFFF
    expect(cpu.regs[4]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// I-format immediates
// ---------------------------------------------------------------------------

describe("I-format immediates", () => {
  test("ADDI sign-extends negative", () => {
    const cpu = vm(`
      ADDI r1, r0, -5
      ECALL
    `);
    cpu.run();
    expect(cpu.regs[1]).toBe(0xFFFB); // -5 as u16
  });

  test("ANDI zero-extends", () => {
    const cpu = vm(`
      ADDI r1, r0, -1
      ANDI r2, r1, 0x3F
      ECALL
    `);
    cpu.run();
    expect(cpu.regs[2]).toBe(0x3F);
  });

  test("ORI zero-extends", () => {
    const cpu = vm(`
      ORI r1, r0, 0x15
      ECALL
    `);
    cpu.run();
    expect(cpu.regs[1]).toBe(0x15);
  });

  test("XORI zero-extends", () => {
    const cpu = vm(`
      ADDI r1, r0, 0x1F
      XORI r2, r1, 0x0F
      ECALL
    `);
    cpu.run();
    expect(cpu.regs[2]).toBe(0x10);
  });

  test("SLLI", () => {
    const cpu = vm(`
      ADDI r1, r0, 1
      SLLI r2, r1, 4
      ECALL
    `);
    cpu.run();
    expect(cpu.regs[2]).toBe(16);
  });

  test("SRLI logical right shift", () => {
    const cpu = vm(`
      ADDI r1, r0, -1
      SRLI r2, r1, 8
      ECALL
    `);
    cpu.run();
    // 0xFFFF >>> 8 = 0x00FF
    expect(cpu.regs[2]).toBe(0xFF);
  });

  test("SRAI arithmetic right shift", () => {
    const cpu = vm(`
      ADDI r1, r0, -8
      SRAI r2, r1, 2
      ECALL
    `);
    cpu.run();
    // -8 >> 2 = -2 = 0xFFFE
    expect(cpu.regs[2]).toBe(0xFFFE);
  });
});

// ---------------------------------------------------------------------------
// Memory operations
// ---------------------------------------------------------------------------

describe("memory operations", () => {
  test("SW and LW round-trip", () => {
    const cpu = vm(`
      LI   r1, 0x1234
      ADDI r2, r0, 0x20
      SW   r1, 0(r2)
      LW   r3, 0(r2)
      ECALL
    `);
    cpu.run();
    expect(cpu.regs[3]).toBe(0x1234);
  });

  test("SW and LW with offset", () => {
    const cpu = vm(`
      ADDI r1, r0, 7
      ADDI r2, r0, 0x20
      SW   r1, 4(r2)
      LW   r3, 4(r2)
      ECALL
    `);
    cpu.run();
    expect(cpu.regs[3]).toBe(7);
  });

  test("SB and LB round-trip", () => {
    const cpu = vm(`
      ADDI r1, r0, 25
      ADDI r2, r0, 0x20
      SB   r1, 0(r2)
      LB   r3, 0(r2)
      ECALL
    `);
    cpu.run();
    expect(cpu.regs[3]).toBe(25);
  });

  test("LB sign-extends", () => {
    // Build address 0x80 via shift, then manually place 0x80 byte there
    const cpu = new Cool16();
    cpu.onEcall = (v) => { v.halted = true; };
    cpu.mem[0x80] = 0x80;
    const result = assemble(`
      ADDI r2, r0, 8
      SLLI r2, r2, 4
      LB   r1, 0(r2)
      ECALL
    `);
    cpu.load(result.program);
    cpu.run();
    // 0x80 sign-extended to 16 bits = 0xFF80
    expect(cpu.regs[1]).toBe(0xFF80);
  });

  test("LW misaligned raises trap", () => {
    const cpu = vm(`
      ADDI r2, r0, 0x21
      LW   r1, 0(r2)
      ECALL
    `);
    cpu.onEcall = () => {};
    cpu.run(10);
    // After misaligned access, CAUSE should be set
    expect(cpu.csrs[Csr.CAUSE]).toBe(Cause.MISALIGNED_ACCESS);
  });

  test("SW misaligned raises trap", () => {
    const cpu = vm(`
      ADDI r1, r0, 7
      ADDI r2, r0, 0x21
      SW   r1, 0(r2)
      ECALL
    `);
    cpu.onEcall = () => {};
    cpu.run(10);
    expect(cpu.csrs[Csr.CAUSE]).toBe(Cause.MISALIGNED_ACCESS);
  });
});

// ---------------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------------

describe("branches", () => {
  test("BEQ taken", () => {
    const cpu = vm(`
      ADDI r1, r0, 5
      ADDI r2, r0, 5
      BEQ  r1, r2, skip
      ADDI r3, r0, 1
    skip:
      ADDI r4, r0, 1
      ECALL
    `);
    cpu.run();
    expect(cpu.regs[3]).toBe(0); // skipped
    expect(cpu.regs[4]).toBe(1); // executed
  });

  test("BEQ not taken", () => {
    const cpu = vm(`
      ADDI r1, r0, 5
      ADDI r2, r0, 3
      BEQ  r1, r2, skip
      ADDI r3, r0, 1
    skip:
      ADDI r4, r0, 1
      ECALL
    `);
    cpu.run();
    expect(cpu.regs[3]).toBe(1); // not skipped
    expect(cpu.regs[4]).toBe(1);
  });

  test("BNE taken", () => {
    const cpu = vm(`
      ADDI r1, r0, 5
      ADDI r2, r0, 3
      BNE  r1, r2, skip
      ADDI r3, r0, 1
    skip:
      ADDI r4, r0, 1
      ECALL
    `);
    cpu.run();
    expect(cpu.regs[3]).toBe(0);
    expect(cpu.regs[4]).toBe(1);
  });

  test("BNE not taken", () => {
    const cpu = vm(`
      ADDI r1, r0, 5
      ADDI r2, r0, 5
      BNE  r1, r2, skip
      ADDI r3, r0, 1
    skip:
      ADDI r4, r0, 1
      ECALL
    `);
    cpu.run();
    expect(cpu.regs[3]).toBe(1);
    expect(cpu.regs[4]).toBe(1);
  });

  test("unconditional branch via BEQ r0, r0", () => {
    const cpu = vm(`
            ADDI r1, r0, 0
    loop:
            ADDI r1, r1, 1
            ADDI r2, r0, 5
            BEQ  r1, r2, done
            BEQ  r0, r0, loop
    done:
            ECALL
    `);
    cpu.run();
    expect(cpu.regs[1]).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// JAL and JALR
// ---------------------------------------------------------------------------

describe("JAL and JALR", () => {
  test("JAL sets r7 to return address and jumps", () => {
    const cpu = vm(`
      JAL  target
      ADDI r1, r0, 1
    target:
      ADDI r2, r0, 2
      ECALL
    `);
    cpu.run();
    expect(cpu.regs[1]).toBe(0); // skipped
    expect(cpu.regs[2]).toBe(2);
    expect(cpu.regs[7]).toBe(2); // return addr = PC+2 of JAL = 0+2 = 2
  });

  test("JALR indirect jump", () => {
    const cpu = vm(`
      JAL  func
      ECALL
    func:
      ADDI r1, r0, 0x0A
      JALR r0, r7
    `);
    cpu.run();
    expect(cpu.regs[1]).toBe(0x0A);
  });
});

// ---------------------------------------------------------------------------
// Pseudo-instructions
// ---------------------------------------------------------------------------

describe("pseudo-instructions", () => {
  test("NOP does nothing", () => {
    const cpu = vm(`
      ADDI r1, r0, 5
      NOP
      ECALL
    `);
    cpu.run();
    expect(cpu.regs[1]).toBe(5);
  });

  test("MOV copies register", () => {
    const cpu = vm(`
      ADDI r1, r0, 0x1A
      MOV  r2, r1
      ECALL
    `);
    cpu.run();
    expect(cpu.regs[2]).toBe(0x1A);
  });

  test("RET returns to caller", () => {
    const cpu = vm(`
      JAL  func
      ECALL
    func:
      ADDI r1, r0, 7
      RET
    `);
    cpu.run();
    expect(cpu.regs[1]).toBe(7);
  });

  test("LI loads small constant", () => {
    const cpu = vm(`
      LI r1, 15
      ECALL
    `);
    cpu.run();
    expect(cpu.regs[1]).toBe(15);
  });

  test("LI loads full-width constant", () => {
    const cpu = vm(`
      LI r1, 0xABCD
      ECALL
    `);
    cpu.run();
    expect(cpu.regs[1]).toBe(0xABCD);
  });

  test("NEG computes two's complement", () => {
    const cpu = vm(`
      ADDI r1, r0, 5
      NEG  r2, r1
      ECALL
    `);
    cpu.run();
    expect(cpu.regs[2]).toBe(0xFFFB);
  });

  test("NOT flips all 16 bits", () => {
    const cpu = vm(`
      LI   r1, 0x1234
      NOT  r2, r1
      ECALL
    `);
    cpu.run();
    expect(cpu.regs[2]).toBe(0xEDCB);
  });

  test("JR jumps without linking", () => {
    const cpu = vm(`
      JAL  setup
      ECALL
    setup:
      LI   r2, 0x000C
      JR   r2
      ADDI r1, r0, 1
      ECALL
    `);
    cpu.run();
    expect(cpu.regs[1]).toBe(0);
  });

  test("SUBI subtracts immediate", () => {
    const cpu = vm(`
      ADDI r1, r0, 9
      SUBI r2, r1, 4
      ECALL
    `);
    cpu.run();
    expect(cpu.regs[2]).toBe(5);
  });

  test("SEQZ and SNEZ derive zero comparisons", () => {
    const cpu = vm(`
      ADDI r1, r0, 0
      ADDI r2, r0, 5
      SEQZ r3, r1
      SEQZ r4, r2
      SNEZ r5, r2
      ECALL
    `);
    cpu.run();
    expect(cpu.regs[3]).toBe(1);
    expect(cpu.regs[4]).toBe(0);
    expect(cpu.regs[5]).toBe(1);
  });

  test("PUSH and POP round-trip through stack", () => {
    const cpu = vm(`
      LI   sp, 0x0040
      LI   r1, 0x1234
      PUSH r1
      POP  r2
      ECALL
    `);
    cpu.run();
    expect(cpu.regs[2]).toBe(0x1234);
    expect(cpu.regs[6]).toBe(0x0040);
  });

  test("CALL and JMP expand to jal-based control flow", () => {
    const cpu = vm(`
      JMP  start
      ADDI r1, r0, 1
    start:
      CALL func
      ECALL
    func:
      ADDI r1, r0, 7
      RET
    `);
    cpu.run();
    expect(cpu.regs[1]).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// System instructions
// ---------------------------------------------------------------------------

describe("system instructions", () => {
  test("ECALL halts by default handler", () => {
    const cpu = vm(`
      ADDI r1, r0, 1
      ECALL
      ADDI r1, r0, 2
    `);
    cpu.run();
    expect(cpu.regs[1]).toBe(1);
    expect(cpu.halted).toBe(true);
  });

  test("CSRR and CSRW in supervisor mode", () => {
    const cpu = vm(`
      ADDI r1, r0, 0x10
      CSRW 0x04, r1
      CSRR r2, 0x04
      ECALL
    `);
    cpu.run();
    expect(cpu.regs[2]).toBe(0x10);
    expect(cpu.csrs[Csr.IVEC]).toBe(0x10);
  });

  test("ECALL in user mode records the user cause and vectors through IVEC", () => {
    const cpu = vm(`
      ECALL
    `);
    cpu.csrs[Csr.STATUS] = 0;
    cpu.csrs[Csr.IVEC] = 0x20;
    cpu.run(1);
    expect(cpu.csrs[Csr.CAUSE]).toBe(Cause.ECALL_USER);
    expect(cpu.csrs[Csr.EPC]).toBe(0);
    expect(cpu.csrs[Csr.ESTATUS]).toBe(0);
    expect(cpu.pc).toBe(0x20 + (Cause.ECALL_USER << 1));
  });

  test("EBREAK records the breakpoint cause and invokes the callback", () => {
    const cpu = vm(`
      EBREAK
    `);
    let hit = false;
    cpu.onEbreak = () => { hit = true; };
    cpu.run(1);
    expect(hit).toBe(true);
    expect(cpu.csrs[Csr.CAUSE]).toBe(Cause.BREAKPOINT);
  });

  test("FENCE is a no-op", () => {
    const cpu = vm(`
      ADDI r1, r0, 1
      FENCE
      ADDI r1, r1, 1
      ECALL
    `);
    cpu.run();
    expect(cpu.regs[1]).toBe(2);
  });

  test("ERET restores pc and status from trap state", () => {
    const cpu = new Cool16();
    cpu.csrs[Csr.EPC] = 0x24;
    cpu.csrs[Csr.ESTATUS] = 0;
    cpu.load(assemble("ERET").program);
    cpu.step();
    expect(cpu.pc).toBe(0x24);
    expect(cpu.csrs[Csr.STATUS]).toBe(0);
  });

  test("ERET in user mode traps as illegal instruction", () => {
    const cpu = vm(`
      ERET
    `);
    cpu.csrs[Csr.STATUS] = 0;
    cpu.onEcall = () => {};
    cpu.run(1);
    expect(cpu.csrs[Csr.CAUSE]).toBe(Cause.ILLEGAL_INSTRUCTION);
  });

  test("user-mode CSR access traps as illegal instruction", () => {
    const cpu = vm(`
      CSRR r1, 0x04
    `);
    cpu.csrs[Csr.STATUS] = 0;
    cpu.onEcall = () => {};
    cpu.run(1);
    expect(cpu.csrs[Csr.CAUSE]).toBe(Cause.ILLEGAL_INSTRUCTION);
  });

  test("illegal special ALU encoding traps", () => {
    const cpu = new Cool16();
    cpu.load([0b0000_001_010_000_111]);
    cpu.step();
    expect(cpu.csrs[Csr.CAUSE]).toBe(Cause.ILLEGAL_INSTRUCTION);
  });
});

// ---------------------------------------------------------------------------
// Fibonacci (integration test)
// ---------------------------------------------------------------------------

describe("programs", () => {
  test("fibonacci computes fib(10) = 89", () => {
    const cpu = vm(`
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
    `);
    cpu.run();
    expect(cpu.regs[1]).toBe(89);
  });

  test("function call with stack save/restore", () => {
    const cpu = vm(`
            ADDI r6, r0, 0x20
            SLLI r6, r6, 4
            ADDI r2, r0, 3
            JAL  double
            ECALL

    double:
            ADDI r6, r6, -2
            SW   r7, 0(r6)
            ADD  r1, r2, r2
            LW   r7, 0(r6)
            ADDI r6, r6, 2
            JALR r0, r7
    `);
    cpu.run();
    expect(cpu.regs[1]).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// VM reset
// ---------------------------------------------------------------------------

describe("reset", () => {
  test("reset clears all state", () => {
    const cpu = vm(`
      ADDI r1, r0, 5
      ECALL
    `);
    cpu.run();
    expect(cpu.regs[1]).toBe(5);
    cpu.reset();
    expect(cpu.regs[1]).toBe(0);
    expect(cpu.pc).toBe(0);
    expect(cpu.halted).toBe(false);
  });
});
