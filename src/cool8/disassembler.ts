// cool8 disassembler — converts machine code back to assembly syntax

import { Op } from "./core";

function reg(index: number): string {
  return `r${index & 3}`;
}

function hex8(value: number): string {
  return `0x${(value & 0xff).toString(16).padStart(2, "0")}`;
}

function sext(value: number, bits: number): number {
  const sign = 1 << (bits - 1);
  return (value ^ sign) - sign;
}

export function disassemble(instr: number, addr?: number): string {
  const op = (instr >> 4) & 0xf;
  const rd = (instr >> 2) & 0x3;
  const rs = instr & 0x3;

  switch (op) {
    case Op.ADD:
      return `ADD ${reg(rd)}, ${reg(rs)}`;
    case Op.SUB:
      return `SUB ${reg(rd)}, ${reg(rs)}`;
    case Op.AND:
      return `AND ${reg(rd)}, ${reg(rs)}`;
    case Op.OR:
      return `OR ${reg(rd)}, ${reg(rs)}`;
    case Op.NOR:
      return `NOR ${reg(rd)}, ${reg(rs)}`;
    case Op.LDI:
      return `LDI ${reg(rd)}, ${rs}`;
    case Op.ADDI: {
      const imm = sext(rs, 2);
      return `ADDI ${reg(rd)}, ${imm}`;
    }
    case Op.SHL: {
      const sh = rs & 3;
      return `SHL ${reg(rd)}, ${sh}`;
    }
    case Op.SHR: {
      const sh = rs & 3;
      return `SHR ${reg(rd)}, ${sh}`;
    }
    case Op.LD:
      return `LD ${reg(rd)}, ${reg(rs)}`;
    case Op.ST:
      return `ST ${reg(rd)}, ${reg(rs)}`;
    case Op.BEQ: {
      const off = sext(instr & 0xf, 4);
      if (addr === undefined) return `BEQ ${off}`;
      const target = (addr + 1 + off) & 0xff;
      return `BEQ ${hex8(target)}`;
    }
    case Op.BNE: {
      const off = sext(instr & 0xf, 4);
      if (addr === undefined) return `BNE ${off}`;
      const target = (addr + 1 + off) & 0xff;
      return `BNE ${hex8(target)}`;
    }
    case Op.BCS: {
      const off = sext(instr & 0xf, 4);
      if (addr === undefined) return `BCS ${off}`;
      const target = (addr + 1 + off) & 0xff;
      return `BCS ${hex8(target)}`;
    }
    case Op.JAL:
      return `JAL ${reg(rd)}, ${reg(rs)}`;
    case Op.SYS:
      return "SYS";
    default:
      return `.byte ${hex8(instr)}`;
  }
}
