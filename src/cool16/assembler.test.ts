import { test, expect, describe } from "bun:test";
import {
  assemble,
  assembleLine,
  tokenizeLine,
  parseStringLiteral,
} from "./assembler";

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
    expect((lb.program[0] >> 12) & 0xf).toBe(0xc);
    expect((sb.program[0] >> 12) & 0xf).toBe(0xd);
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
    const imm6 = result.program[0] & 0x3f;
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
    const imm6 = result.program[1] & 0x3f;
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
    // JAL at addr 0, target at addr 4, default rd=7
    // offset = (4 - 2) >> 1 = 1
    expect((result.program[0] >> 9) & 0x7).toBe(7);
    const imm9 = result.program[0] & 0x1ff;
    expect(imm9).toBe(1);
  });

  test("JAL rd, label encodes selected destination register", () => {
    const result = assemble(`
      JAL r3, target
    target:
      NOP
    `);
    expect(result.errors.length).toBe(0);
    expect((result.program[0] >> 9) & 0x7).toBe(3);
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
    expect(result.program).toEqual(new Uint16Array([0b0000_010_000_001_001]));
  });

  test("NOT r2, r1 expands to negation-minus-one sequence", () => {
    const result = assemble("NOT r2, r1");
    expect(result.program).toEqual(
      new Uint16Array([0b0000_010_000_001_001, 0b0001_010_010_111111]),
    );
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
    expect(result.program).toEqual(
      new Uint16Array([0b0000_010_000_001_110, 0b0100_010_010_000001]),
    );
  });

  test("SNEZ r2, r1 expands to SLTU r2, r0, r1", () => {
    const result = assemble("SNEZ r2, r1");
    expect(result.program).toEqual(new Uint16Array([0b0000_010_000_001_110]));
  });

  test("PUSH r3 expands to stack decrement and store", () => {
    const result = assemble("PUSH r3");
    expect(result.program).toEqual(
      new Uint16Array([0b0001_110_110_111110, 0b1001_011_110_000000]),
    );
  });

  test("POP r3 expands to load and stack increment", () => {
    const result = assemble("POP r3");
    expect(result.program).toEqual(
      new Uint16Array([0b1000_011_110_000000, 0b0001_110_110_000010]),
    );
  });

  test("CALL label encodes as JAL label", () => {
    const result = assemble(`
      CALL target
      NOP
    target:
      NOP
    `);
    expect(result.errors.length).toBe(0);
    expect(result.program[0]).toBe(
      assemble(`
      JAL target
      NOP
    target:
      NOP
    `).program[0],
    );
  });

  test("JMP label encodes as JAL label", () => {
    const result = assemble(`
      JMP target
      NOP
    target:
      NOP
    `);
    expect(result.errors.length).toBe(0);
    expect(result.program[0]).toBe(
      assemble(`
      JAL target
      NOP
    target:
      NOP
    `).program[0],
    );
  });

  test("LI r1, 0xABCD expands to a five-instruction sequence (bit 6 set)", () => {
    const result = assemble("LI r1, 0xABCD");
    expect(result.errors.length).toBe(0);
    expect(result.program.length).toBe(5);
    expect(result.program).toEqual(
      new Uint16Array([
        0b0001_001_000_101010, 0b0101_001_001_000110, 0b0011_001_001_111100,
        0b0101_001_001_000100, 0b0011_001_001_001101,
      ]),
    );
  });

  test("LI r1, 0x1234 expands to LUI+ORI (bit 6 = 0)", () => {
    const result = assemble("LI r1, 0x1234");
    expect(result.errors.length).toBe(0);
    expect(result.program.length).toBe(2);
    // LUI r1, 0x24 (0x1234 >> 7 = 0x24): op=0111, rd=001, imm9=000100100
    // ORI r1, r1, 0x34 (0x1234 & 0x3F = 0x34): op=0011, rd=001, rs1=001, imm6=110100
    expect(result.program[0]).toBe(0b0111_001_000100100);
    expect(result.program[1]).toBe(0b0011_001_001_110100);
  });

  test("LUI r1, 0x24 encodes correctly", () => {
    const result = assemble("LUI r1, 0x24");
    expect(result.errors.length).toBe(0);
    // op=0111, rd=001, imm9=000100100
    expect(result.program[0]).toBe(0b0111_001_000100100);
  });
});

describe("register aliases", () => {
  test("sp maps to r6", () => {
    const withAlias = assemble("ADDI sp, sp, -2");
    const withReg = assemble("ADDI r6, r6, -2");
    expect(withAlias.program[0]).toBe(withReg.program[0]);
  });

  test("lr maps to r7", () => {
    const withAlias = assemble("JALR r0, lr");
    const withReg = assemble("JALR r0, r7");
    expect(withAlias.program[0]).toBe(withReg.program[0]);
  });
});

describe("pass 1 address calculation", () => {
  test("PUSH (4 bytes) correctly offsets following label", () => {
    const result = assemble(`
      PUSH r1
    after:
      NOP
    `);
    expect(result.errors.length).toBe(0);
    expect(result.labels.get("after")).toBe(4);
  });

  test("POP (4 bytes) correctly offsets following label", () => {
    const result = assemble(`
      POP r1
    after:
      NOP
    `);
    expect(result.errors.length).toBe(0);
    expect(result.labels.get("after")).toBe(4);
  });

  test("NOT (4 bytes) correctly offsets following label", () => {
    const result = assemble(`
      NOT r1, r2
    after:
      NOP
    `);
    expect(result.errors.length).toBe(0);
    expect(result.labels.get("after")).toBe(4);
  });

  test("LI large (10 bytes) correctly offsets following label", () => {
    const result = assemble(`
      LI r1, 0xABCD
    after:
      NOP
    `);
    expect(result.errors.length).toBe(0);
    expect(result.labels.get("after")).toBe(10);
  });

  test("LI small (2 bytes) correctly offsets following label", () => {
    const result = assemble(`
      LI r1, 5
    after:
      NOP
    `);
    expect(result.errors.length).toBe(0);
    expect(result.labels.get("after")).toBe(2);
  });
});

describe(".equ directive", () => {
  test(".equ defines a named constant usable in ADDI", () => {
    const result = assemble(`
      .equ N, 10
      ADDI r1, r0, N
    `);
    expect(result.errors.length).toBe(0);
    // N=10, same as ADDI r1, r0, 10
    expect(result.program[0]).toBe(assemble("ADDI r1, r0, 10").program[0]);
  });

  test(".equ with hex value", () => {
    const result = assemble(`
      .equ MASK, 0x3F
      ADDI r1, r0, MASK
    `);
    expect(result.errors.length).toBe(0);
    expect(result.program[0]).toBe(0b0001_001_000_111111);
  });

  test(".equ does not contribute to program size", () => {
    const result = assemble(`
      .equ X, 5
      NOP
    `);
    expect(result.errors.length).toBe(0);
    expect(result.program.length).toBe(1);
  });

  test(".equ constant usable in LI", () => {
    const result = assemble(`
      .equ STACK, 0xFE00
      LI r6, STACK
    `);
    expect(result.errors.length).toBe(0);
    expect(result.program.length).toBe(5); // large LI expands to 5 words
  });
});

describe(".byte directive", () => {
  test(".byte emits byte pairs as little-endian u16 words", () => {
    const result = assemble(".byte 0x48, 0x65, 0x6C, 0x6C");
    expect(result.errors.length).toBe(0);
    expect(result.program.length).toBe(2);
    expect(result.program[0]).toBe(0x6548); // 0x48 lo, 0x65 hi
    expect(result.program[1]).toBe(0x6c6c);
  });

  test(".byte with odd count pads with 0x00", () => {
    const result = assemble(".byte 0x41, 0x42, 0x43");
    expect(result.errors.length).toBe(0);
    expect(result.program.length).toBe(2);
    expect(result.program[0]).toBe(0x4241); // 'A' lo, 'B' hi
    expect(result.program[1]).toBe(0x0043); // 'C' lo, 0x00 hi
  });

  test(".byte label address is correct", () => {
    const result = assemble(`
      NOP
    data:
      .byte 0x01, 0x02
    after:
      NOP
    `);
    expect(result.errors.length).toBe(0);
    expect(result.labels.get("data")).toBe(2);
    expect(result.labels.get("after")).toBe(4);
  });
});

describe(".ascii directive", () => {
  test("parseStringLiteral handles basic string", () => {
    expect(parseStringLiteral('"AB"')).toEqual([0x41, 0x42]);
  });

  test("parseStringLiteral handles escape sequences", () => {
    expect(parseStringLiteral('"\\n\\t\\r\\0\\\\"')).toEqual([
      10, 9, 13, 0, 92,
    ]);
  });

  test(".ascii emits string bytes as little-endian u16 words", () => {
    const result = assemble('.ascii "AB"');
    expect(result.errors.length).toBe(0);
    expect(result.program.length).toBe(1);
    expect(result.program[0]).toBe(0x4241); // 'A'=0x41 lo, 'B'=0x42 hi
  });

  test(".ascii pads odd-length strings with 0x00", () => {
    const result = assemble('.ascii "A"');
    expect(result.errors.length).toBe(0);
    expect(result.program.length).toBe(1);
    expect(result.program[0]).toBe(0x0041); // 'A' lo, 0x00 hi
  });

  test(".ascii handles escape sequences", () => {
    const result = assemble('.ascii "\\n\\0"');
    expect(result.errors.length).toBe(0);
    expect(result.program.length).toBe(1);
    expect(result.program[0]).toBe(0x000a); // 0x0A lo, 0x00 hi
  });

  test(".ascii with comma in string assembles correctly", () => {
    const result = assemble('.ascii "A,B"');
    expect(result.errors.length).toBe(0);
    expect(result.program.length).toBe(2); // 3 bytes → padded to 4 = 2 words
  });

  test(".ascii label address accounts for string size", () => {
    const result = assemble(`
      NOP
    str:
      .ascii "ABCD"
    after:
      NOP
    `);
    expect(result.errors.length).toBe(0);
    expect(result.labels.get("str")).toBe(2);
    expect(result.labels.get("after")).toBe(6); // 2 + 4 bytes = 6
  });
});

describe("local label scoping", () => {
  test("dot labels are scoped to nearest global label", () => {
    const result = assemble(`
    foo:
    .inner:
      NOP
    bar:
    .inner:
      NOP
    `);
    expect(result.errors.length).toBe(0);
    expect(result.labels.get("foo.inner")).toBe(0);
    expect(result.labels.get("bar.inner")).toBe(2);
  });

  test("local label references resolve within their scope", () => {
    const result = assemble(`
    loop:
    .start:
      NOP
      BEQ r0, r0, .start
    `);
    expect(result.errors.length).toBe(0);
    // .start is at addr 0, BEQ is at addr 2
    // offset = (0 - (2+2)) >> 1 = -2, which is 0b111110 in 6-bit
    const imm6 = result.program[1] & 0x3f;
    expect(imm6).toBe(0b111110);
  });

  test("same local label name in different scopes does not collide", () => {
    const result = assemble(`
    a:
    .end:
      NOP
    b:
    .end:
      NOP
    `);
    expect(result.errors.length).toBe(0);
    expect(result.labels.get("a.end")).toBe(0);
    expect(result.labels.get("b.end")).toBe(2);
  });

  test("fibonacci-style local labels all resolve correctly", () => {
    const result = assemble(`
    fib:
      BEQ r0, r0, .done
    .loop:
      NOP
      BEQ r0, r0, .loop
    .done:
      NOP
    `);
    expect(result.errors.length).toBe(0);
    // BEQ at addr 0 → .done at addr 6, offset = (6-(0+2))>>1 = 2
    expect(result.program[0] & 0x3f).toBe(2);
    // BEQ at addr 4 → .loop at addr 2, offset = (2-(4+2))>>1 = -2 = 0b111110
    expect(result.program[2] & 0x3f).toBe(0b111110);
  });
});

describe("RISC-V compatibility layer", () => {
  test("tokenizeLine strips # comments", () => {
    expect(tokenizeLine("add x1, x0, 1 # comment")).toEqual({
      label: null,
      mnemonic: "ADD",
      args: ["x1", "x0", "1"],
    });
  });

  test("RISC-V register aliases map onto cool16 registers", () => {
    const withAlias = assemble("ADDI ra, sp, 1");
    const withReg = assemble("ADDI r7, r6, 1");
    expect(withAlias.program[0]).toBe(withReg.program[0]);
  });

  test("unsupported x8 register is rejected", () => {
    const result = assemble("ADDI x8, x0, 1");
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].message).toContain("invalid operand");
  });

  test("mv and j pseudos are accepted", () => {
    const mv = assemble("mv x1, x2");
    const mov = assemble("MOV x1, x2");
    expect(mv.program[0]).toBe(mov.program[0]);

    const j = assemble("j target\n target: NOP");
    const jmp = assemble("jmp target\n target: NOP");
    expect(j.program[0]).toBe(jmp.program[0]);
  });

  test("beqz and bnez pseudos are accepted", () => {
    const beqz = assemble("beqz t0, done\n done: NOP");
    const beq = assemble("beq t0, r0, done\n done: NOP");
    expect(beqz.program[0]).toBe(beq.program[0]);

    const bnez = assemble("bnez t1, done\n done: NOP");
    const bne = assemble("bne t1, r0, done\n done: NOP");
    expect(bnez.program[0]).toBe(bne.program[0]);
  });

  test("jal supports both default-link and explicit rd,label forms", () => {
    const jalRa = assemble("jal ra, target\n target: NOP");
    const jalOneArg = assemble("jal target\n target: NOP");
    expect(jalRa.errors.length).toBe(0);
    expect(jalRa.program[0]).toBe(jalOneArg.program[0]);

    const jalX0 = assemble("jal x0, target\n target: NOP");
    expect(jalX0.errors.length).toBe(0);
    expect((jalX0.program[0] >> 9) & 0x7).toBe(0);
  });

  test("jalr supports rd, 0(rs1) and rejects non-zero offset", () => {
    const jalrMem = assemble("jalr x0, 0(ra)");
    const ret = assemble("ret");
    expect(jalrMem.errors.length).toBe(0);
    expect(jalrMem.program[0]).toBe(ret.program[0]);

    const invalid = assemble("jalr x0, 4(ra)");
    expect(invalid.errors.length).toBe(1);
    expect(invalid.errors[0].message).toContain("only supports 0(rs1)");
  });

  test("memory operands accept .equ constants", () => {
    const result = assemble(`
      .equ OFF, 4
      lw x1, OFF(sp)
    `);
    expect(result.errors.length).toBe(0);
    expect(result.program[0]).toBe(assemble("lw x1, 4(sp)").program[0]);
  });
});
