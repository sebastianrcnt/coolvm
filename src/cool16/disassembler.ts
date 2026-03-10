import { Func, Op, Sys } from "./core";

function sext(value: number, bits: number): number {
  const mask = 1 << (bits - 1);
  return ((value ^ mask) - mask) & 0xffff;
}

function reg(n: number): string {
  return `r${n}`;
}

function hex16(value: number): string {
  return `0x${(value & 0xffff).toString(16).padStart(4, "0")}`;
}

function signed(value: number, bits: number): number {
  return (sext(value, bits) << 16) >> 16;
}

export function disassemble(instr: number, addr?: number): string {
  const op = (instr >> 12) & 0xf;

  switch (op) {
    case Op.ALU: {
      const rd = (instr >> 9) & 0x7;
      const rs1 = (instr >> 6) & 0x7;
      const rs2 = (instr >> 3) & 0x7;
      const func = instr & 0x7;
      const mnemonics: Record<number, string> = {
        [Func.ADD]: "ADD",
        [Func.SUB]: "SUB",
        [Func.AND]: "AND",
        [Func.OR]: "OR",
        [Func.XOR]: "XOR",
        [Func.SLT]: "SLT",
        [Func.SLTU]: "SLTU",
      };
      if (func === Func.SPECIAL) {
        return rs2 === 0b111
          ? `JALR ${reg(rd)}, ${reg(rs1)}`
          : `.word ${hex16(instr)} ; illegal`;
      }
      return `${mnemonics[func]} ${reg(rd)}, ${reg(rs1)}, ${reg(rs2)}`;
    }

    case Op.ADDI:
    case Op.ANDI:
    case Op.ORI:
    case Op.XORI:
    case Op.SLLI:
    case Op.SRLI: {
      const rd = (instr >> 9) & 0x7;
      const rs1 = (instr >> 6) & 0x7;
      const imm = instr & 0x3f;
      const mnemonic: Record<number, string> = {
        [Op.ADDI]: "ADDI",
        [Op.ANDI]: "ANDI",
        [Op.ORI]: "ORI",
        [Op.XORI]: "XORI",
        [Op.SLLI]: "SLLI",
        [Op.SRLI]: "SRLI",
      };
      const renderedImm = op === Op.ADDI ? signed(imm, 6) : imm;
      return `${mnemonic[op]} ${reg(rd)}, ${reg(rs1)}, ${renderedImm}`;
    }

    case Op.LUI: {
      const rd = (instr >> 9) & 0x7;
      const imm9 = instr & 0x1ff;
      return `LUI ${reg(rd)}, ${imm9}`;
    }

    case Op.LW:
    case Op.SW:
    case Op.LB:
    case Op.SB: {
      const regField = (instr >> 9) & 0x7;
      const base = (instr >> 6) & 0x7;
      const off = signed(instr & 0x3f, 6);
      const mnemonic: Record<number, string> = {
        [Op.LW]: "LW",
        [Op.SW]: "SW",
        [Op.LB]: "LB",
        [Op.SB]: "SB",
      };
      return `${mnemonic[op]} ${reg(regField)}, ${off}(${reg(base)})`;
    }

    case Op.JAL: {
      const rd = (instr >> 9) & 0x7;
      const off = signed(instr & 0x1ff, 9);
      if (addr !== undefined) {
        return `JAL ${reg(rd)}, ${hex16(addr + 2 + (off << 1))}`;
      }
      return `JAL ${reg(rd)}, ${off}`;
    }

    case Op.SYS: {
      const sub = (instr >> 9) & 0x7;
      const regField = (instr >> 6) & 0x7;
      const csr = instr & 0x3f;
      switch (sub) {
        case Sys.ECALL:
          return regField === 0 && csr === 0
            ? "ECALL"
            : `.word ${hex16(instr)} ; illegal`;
        case Sys.EBREAK:
          return regField === 0 && csr === 0
            ? "EBREAK"
            : `.word ${hex16(instr)} ; illegal`;
        case Sys.ERET:
          return regField === 0 && csr === 0
            ? "ERET"
            : `.word ${hex16(instr)} ; illegal`;
        case Sys.SRAI: {
          const rs1 = (csr >> 3) & 0x7;
          const shamt = csr & 0x7;
          return `SRAI ${reg(regField)}, ${reg(rs1)}, ${shamt}`;
        }
        case Sys.CSRR:
          return `CSRR ${reg(regField)}, 0x${csr.toString(16).padStart(2, "0")}`;
        case Sys.CSRW:
          return `CSRW 0x${csr.toString(16).padStart(2, "0")}, ${reg(regField)}`;
        default:
          return `.word ${hex16(instr)} ; illegal`;
      }
    }

    case Op.BEQ:
    case Op.BNE: {
      const rs1 = (instr >> 9) & 0x7;
      const rs2 = (instr >> 6) & 0x7;
      const off = signed(instr & 0x3f, 6);
      const mnemonic = op === Op.BEQ ? "BEQ" : "BNE";
      if (addr !== undefined) {
        return `${mnemonic} ${reg(rs1)}, ${reg(rs2)}, ${hex16(addr + 2 + (off << 1))}`;
      }
      return `${mnemonic} ${reg(rs1)}, ${reg(rs2)}, ${off}`;
    }

    default:
      return `.word ${hex16(instr)}`;
  }
}
