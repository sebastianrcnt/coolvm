import { describe, expect, test } from "bun:test";
import { assemble } from "./assembler";
import { disassemble } from "./disassembler";

describe("disassemble", () => {
  test("decodes ALU instructions", () => {
    const instr = assemble("ADD r1, r2, r3").program[0];
    expect(disassemble(instr)).toBe("ADD r1, r2, r3");
  });

  test("renders absolute branch targets when addr is provided", () => {
    const instr = assemble("BEQ r1, r2, 1").program[0];
    expect(disassemble(instr, 0x0000)).toBe("BEQ r1, r2, 0x0004");
  });

  test("renders absolute jump targets when addr is provided", () => {
    const instr = assemble("JAL r7, 2").program[0];
    expect(disassemble(instr, 0x0010)).toBe("JAL r7, 0x0016");
  });

  test("decodes system instructions", () => {
    const instr = assemble("CSRW 0x04, r1").program[0];
    expect(disassemble(instr)).toBe("CSRW 0x04, r1");
  });

  test("marks illegal special encodings", () => {
    expect(disassemble(0b0000_001_010_000_111)).toBe(".word 0x0287 ; illegal");
  });
});
