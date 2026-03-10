import { test, expect, describe } from "bun:test";
import { assemble, assembleLine, tokenizeLine } from "./assembler";

describe("assembler basics", () => {
  test("tokenizeLine exports label, mnemonic, and args", () => {
    expect(tokenizeLine("start: ADDI r1, r0, 5 ; comment")).toEqual({
      label: "start",
      mnemonic: "ADDI",
      args: ["r1", "r0", "5"],
    });
  });

  test("empty source produces empty program", () => {
    const result = assemble("");
    expect(result.program.length).toBe(0);
    expect(result.errors.length).toBe(0);
  });

  test("comments and blank lines are ignored", () => {
    const result = assemble(`
      ; this is a comment
      ; another comment

      ADDI r1, r0, 5
    `);
    expect(result.program.length).toBe(1);
    expect(result.errors.length).toBe(0);
  });

  test("labels are collected at correct addresses", () => {
    const result = assemble(`
    start:
      ADDI r1, r0, 1
      ADDI r2, r0, 2
    end:
      ECALL
    `);
    expect(result.labels.get("start")).toBe(0);
    expect(result.labels.get("end")).toBe(4);
  });

  test("duplicate labels produce error", () => {
    const result = assemble(`
    foo:
      NOP
    foo:
      NOP
    `);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain("duplicate label");
  });

  test("unknown instruction produces error", () => {
    const result = assemble("BOGUS r1, r2");
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].message).toContain("unknown instruction");
  });

  test("assembleLine assembles a single base instruction", () => {
    expect(assembleLine("ADDI", ["r1", "r0", "5"], 0, new Map())).toEqual({
      words: [0b0001_001_000_000101],
    });
  });

  test("assembleLine expands a multiword pseudo-instruction", () => {
    expect(assembleLine("PUSH", ["r3"], 0, new Map())).toEqual({
      words: [0b0001_110_110_111110, 0b1001_011_110_000000],
    });
  });

  test("assembleLine resolves labels relative to the provided address", () => {
    const labels = new Map([["target", 4]]);
    expect(assembleLine("BEQ", ["r1", "r2", "target"], 0, labels)).toEqual({
      words: [0b1110_001_010_000001],
    });
  });

  test("assembleLine reports errors without throwing", () => {
    expect(assembleLine("ADDI", ["r9", "r0", "5"], 0, new Map())).toEqual({
      words: [0],
      error: "invalid operand",
    });
  });
});

describe("R-format encoding", () => {
  test("ADD r1, r2, r3 encodes correctly", () => {
    // op=0000, rd=001, rs1=010, rs2=011, func=000
    // 0000_001_010_011_000 = 0x0498
    const result = assemble("ADD r1, r2, r3");
    expect(result.program[0]).toBe(0b0000_001_010_011_000);
  });

  test("SUB r3, r1, r2 encodes correctly", () => {
    // op=0000, rd=011, rs1=001, rs2=010, func=001
    // 0000_011_001_010_001
    const result = assemble("SUB r3, r1, r2");
    expect(result.program[0]).toBe(0b0000_011_001_010_001);
  });

  test("JALR r1, r2 encodes correctly", () => {
    // op=0000, rd=001, rs1=010, rs2=111, func=111
    const result = assemble("JALR r1, r2");
    expect(result.program[0]).toBe(0b0000_001_010_111_111);
  });
});

describe("I-format encoding", () => {
  test("ADDI r1, r0, 5 encodes correctly", () => {
    // op=0001, rd=001, rs1=000, imm6=000101
    const result = assemble("ADDI r1, r0, 5");
    expect(result.program[0]).toBe(0b0001_001_000_000101);
  });

  test("ADDI with negative immediate", () => {
    // op=0001, rd=001, rs1=000, imm6=-1 = 0b111111
    const result = assemble("ADDI r1, r0, -1");
    expect(result.program[0]).toBe(0b0001_001_000_111111);
  });

  test("SLLI r2, r1, 4 encodes correctly", () => {
    // op=0101, rd=010, rs1=001, imm6=000100
    const result = assemble("SLLI r2, r1, 4");
    expect(result.program[0]).toBe(0b0101_010_001_000100);
  });
});

describe("M-format encoding", () => {
  test("LW r1, 0(r2) encodes correctly", () => {
    // op=1000, reg=001, base=010, imm6=000000
    const result = assemble("LW r1, 0(r2)");
    expect(result.program[0]).toBe(0b1000_001_010_000000);
  });

  test("SW r3, 4(r6) encodes correctly", () => {
    // op=1001, reg=011, base=110, imm6=000100
    const result = assemble("SW r3, 4(r6)");
    expect(result.program[0]).toBe(0b1001_011_110_000100);
  });

  test("LB and SB use correct opcodes", () => {
    const lb = assemble("LB r1, 0(r2)");
    const sb = assemble("SB r1, 0(r2)");
    expect((lb.program[0] >> 12) & 0xF).toBe(0xC);
    expect((sb.program[0] >> 12) & 0xF).toBe(0xD);
  });
});

describe("B-format encoding", () => {
  test("BEQ forward branch resolves label", () => {
    const result = assemble(`
      BEQ r1, r2, target
      NOP
    target:
      NOP
    `);
    expect(result.errors.length).toBe(0);
    // BEQ at addr 0, target at addr 4
    // offset = (4 - (0+2)) >> 1 = 1
    const imm6 = result.program[0] & 0x3F;
    expect(imm6).toBe(1);
  });

  test("BEQ backward branch resolves label", () => {
    const result = assemble(`
    loop:
      NOP
      BEQ r0, r0, loop
    `);
    expect(result.errors.length).toBe(0);
    // BEQ at addr 2, loop at addr 0
    // offset = (0 - (2+2)) >> 1 = -2
    const imm6 = result.program[1] & 0x3F;
    // -2 in 6-bit two's complement = 0b111110 = 62
    expect(imm6).toBe(0b111110);
  });
});

describe("J-format encoding", () => {
  test("JAL forward resolves label", () => {
    const result = assemble(`
      JAL target
      NOP
    target:
      NOP
    `);
    expect(result.errors.length).toBe(0);
    // JAL at addr 0, target at addr 4
    // offset = (4 - 2) >> 1 = 1
    const imm12 = result.program[0] & 0xFFF;
    expect(imm12).toBe(1);
  });
});

describe("SYS-format encoding", () => {
  test("ECALL encodes as op=0xB, sub=000, rest=0", () => {
    const result = assemble("ECALL");
    expect(result.program[0]).toBe(0b1011_000_000_000000);
  });

  test("EBREAK encodes correctly", () => {
    const result = assemble("EBREAK");
    expect(result.program[0]).toBe(0b1011_001_000_000000);
  });

  test("ERET encodes correctly", () => {
    const result = assemble("ERET");
    expect(result.program[0]).toBe(0b1011_010_000_000000);
  });

  test("CSRR r1, 0x04 encodes correctly", () => {
    // op=1011, sub=100, reg=001, csr=000100
    const result = assemble("CSRR r1, 0x04");
    expect(result.program[0]).toBe(0b1011_100_001_000100);
  });

  test("CSRW 0x04, r1 encodes correctly", () => {
    // op=1011, sub=101, reg=001, csr=000100
    const result = assemble("CSRW 0x04, r1");
    expect(result.program[0]).toBe(0b1011_101_001_000100);
  });
});

describe("pseudo-instructions", () => {
  test("NOP encodes as ADD r0, r0, r0", () => {
    const result = assemble("NOP");
    expect(result.program[0]).toBe(0b0000_000_000_000_000);
  });

  test("MOV r2, r1 encodes as ADD r2, r1, r0", () => {
    const result = assemble("MOV r2, r1");
    expect(result.program[0]).toBe(0b0000_010_001_000_000);
  });

  test("RET encodes as JALR r0, r7", () => {
    const result = assemble("RET");
    expect(result.program[0]).toBe(0b0000_000_111_111_111);
  });

  test("LI r1, 5 encodes as ADDI r1, r0, 5", () => {
    const result = assemble("LI r1, 5");
    const addi = assemble("ADDI r1, r0, 5");
    expect(result.program[0]).toBe(addi.program[0]);
  });

  test("NEG r2, r1 encodes as SUB r2, r0, r1", () => {
    const result = assemble("NEG r2, r1");
    expect(result.program).toEqual(new Uint16Array([
      0b0000_010_000_001_001,
    ]));
  });

  test("NOT r2, r1 expands to negation-minus-one sequence", () => {
    const result = assemble("NOT r2, r1");
    expect(result.program).toEqual(new Uint16Array([
      0b0000_010_000_001_001,
      0b0001_010_010_111111,
    ]));
  });

  test("JR r3 encodes as JALR r0, r3", () => {
    const result = assemble("JR r3");
    expect(result.program[0]).toBe(0b0000_000_011_111_111);
  });

  test("SUBI r2, r1, 5 encodes as ADDI r2, r1, -5", () => {
    const result = assemble("SUBI r2, r1, 5");
    const addi = assemble("ADDI r2, r1, -5");
    expect(result.program[0]).toBe(addi.program[0]);
  });

  test("SEQZ r2, r1 expands to SLTU/XORI", () => {
    const result = assemble("SEQZ r2, r1");
    expect(result.program).toEqual(new Uint16Array([
      0b0000_010_000_001_110,
      0b0100_010_010_000001,
    ]));
  });

  test("SNEZ r2, r1 expands to SLTU r2, r0, r1", () => {
    const result = assemble("SNEZ r2, r1");
    expect(result.program).toEqual(new Uint16Array([
      0b0000_010_000_001_110,
    ]));
  });

  test("PUSH r3 expands to stack decrement and store", () => {
    const result = assemble("PUSH r3");
    expect(result.program).toEqual(new Uint16Array([
      0b0001_110_110_111110,
      0b1001_011_110_000000,
    ]));
  });

  test("POP r3 expands to load and stack increment", () => {
    const result = assemble("POP r3");
    expect(result.program).toEqual(new Uint16Array([
      0b1000_011_110_000000,
      0b0001_110_110_000010,
    ]));
  });

  test("CALL label encodes as JAL label", () => {
    const result = assemble(`
      CALL target
      NOP
    target:
      NOP
    `);
    expect(result.errors.length).toBe(0);
    expect(result.program[0]).toBe(assemble(`
      JAL target
      NOP
    target:
      NOP
    `).program[0]);
  });

  test("JMP label encodes as JAL label", () => {
    const result = assemble(`
      JMP target
      NOP
    target:
      NOP
    `);
    expect(result.errors.length).toBe(0);
    expect(result.program[0]).toBe(assemble(`
      JAL target
      NOP
    target:
      NOP
    `).program[0]);
  });

  test("LI r1, 0xABCD expands to a five-instruction sequence", () => {
    const result = assemble("LI r1, 0xABCD");
    expect(result.errors.length).toBe(0);
    expect(result.program.length).toBe(5);
    expect(result.program).toEqual(new Uint16Array([
      0b0001_001_000_101010,
      0b0101_001_001_000110,
      0b0011_001_001_111100,
      0b0101_001_001_000100,
      0b0011_001_001_001101,
    ]));
  });
});

describe("register aliases", () => {
  test("sp maps to r6", () => {
    const withAlias = assemble("ADDI sp, sp, -2");
    const withReg   = assemble("ADDI r6, r6, -2");
    expect(withAlias.program[0]).toBe(withReg.program[0]);
  });

  test("lr maps to r7", () => {
    const withAlias = assemble("JALR r0, lr");
    const withReg   = assemble("JALR r0, r7");
    expect(withAlias.program[0]).toBe(withReg.program[0]);
  });
});
