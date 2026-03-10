// cool16 assembler — converts assembly text to machine code
// See specs/cool16.md for the full ISA specification.

import { Op, Func, Sys } from "./core";

// --- Types ---

export interface AssembleResult {
  program: Uint16Array;
  labels: Map<string, number>;
  errors: AssembleError[];
}

export interface AssembleError {
  line: number;
  message: string;
}

// --- Register parsing ---

const REG_NAMES: Record<string, number> = {
  r0: 0, r1: 1, r2: 2, r3: 3, r4: 4, r5: 5, r6: 6, r7: 7,
  sp: 6, lr: 7,
};

function parseReg(token: string): number | null {
  const r = REG_NAMES[token.toLowerCase()];
  return r !== undefined ? r : null;
}

// --- Immediate parsing ---

function parseImm(token: string): number | null {
  const trimmed = token.trim();
  if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) {
    const v = parseInt(trimmed, 16);
    return isNaN(v) ? null : v;
  }
  if (trimmed.startsWith("0b") || trimmed.startsWith("0B")) {
    const v = parseInt(trimmed.slice(2), 2);
    return isNaN(v) ? null : v;
  }
  const v = parseInt(trimmed, 10);
  return isNaN(v) ? null : v;
}

// --- Memory operand parsing: imm6(base) ---

function parseMemOperand(token: string): { imm: number; base: number } | null {
  const match = token.match(/^(-?\d+|0x[0-9a-fA-F]+)\((\w+)\)$/);
  if (!match) return null;
  const imm = parseImm(match[1]);
  const base = parseReg(match[2]);
  if (imm === null || base === null) return null;
  return { imm, base };
}

// --- Encoding helpers ---

function encodeR(rd: number, rs1: number, rs2: number, func: number): number {
  return (Op.ALU << 12) | (rd << 9) | (rs1 << 6) | (rs2 << 3) | func;
}

function encodeI(op: number, rd: number, rs1: number, imm6: number): number {
  return (op << 12) | (rd << 9) | (rs1 << 6) | (imm6 & 0x3F);
}

function encodeM(op: number, reg: number, base: number, imm6: number): number {
  return (op << 12) | (reg << 9) | (base << 6) | (imm6 & 0x3F);
}

function encodeB(op: number, rs1: number, rs2: number, imm6: number): number {
  return (op << 12) | (rs1 << 9) | (rs2 << 6) | (imm6 & 0x3F);
}

function encodeJ(imm12: number): number {
  return (Op.JAL << 12) | (imm12 & 0xFFF);
}

function encodeSys(sub: number, reg = 0, csr = 0): number {
  return (Op.SYS << 12) | (sub << 9) | (reg << 6) | (csr & 0x3F);
}

// --- Tokenizer ---

function tokenizeLine(raw: string): { label: string | null; mnemonic: string | null; args: string[] } {
  // Strip comments
  const line = raw.split(";")[0].trim();
  if (!line) return { label: null, mnemonic: null, args: [] };

  let rest = line;
  let label: string | null = null;

  // Check for label (ends with ':')
  const colonIdx = rest.indexOf(":");
  if (colonIdx >= 0) {
    label = rest.slice(0, colonIdx).trim();
    rest = rest.slice(colonIdx + 1).trim();
  }

  if (!rest) return { label, mnemonic: null, args: [] };

  // Split mnemonic and arguments
  const parts = rest.split(/\s+/);
  const mnemonic = parts[0].toUpperCase();
  const argStr = parts.slice(1).join(" ");
  const args = argStr ? argStr.split(",").map((a) => a.trim()) : [];

  return { label, mnemonic, args };
}

// --- Assembler (two-pass) ---

export function assemble(source: string): AssembleResult {
  const lines = source.split("\n");
  const errors: AssembleError[] = [];
  const labels = new Map<string, number>();
  const instructions: Array<{
    lineNum: number;
    mnemonic: string;
    args: string[];
  }> = [];

  // --- Pass 1: collect labels, count instructions ---
  let addr = 0;
  for (let i = 0; i < lines.length; i++) {
    const { label, mnemonic, args } = tokenizeLine(lines[i]);
    if (label) {
      if (labels.has(label)) {
        errors.push({ line: i + 1, message: `duplicate label: ${label}` });
      } else {
        labels.set(label, addr);
      }
    }
    if (mnemonic) {
      instructions.push({ lineNum: i + 1, mnemonic, args });
      addr += 2;
    }
  }

  // --- Pass 2: encode instructions ---
  const words: number[] = [];

  for (const { lineNum, mnemonic, args } of instructions) {
    const emit = (word: number) => words.push(word & 0xFFFF);
    const err = (msg: string) => errors.push({ line: lineNum, message: msg });

    const currentAddr = words.length * 2;

    // Helper to resolve a label or immediate as a branch offset (in imm6, pre-shifted)
    const resolveBranchOff = (token: string): number | null => {
      const label = labels.get(token);
      if (label !== undefined) {
        const rel = label - (currentAddr + 2); // relative to PC+2
        return rel >> 1; // pre-shifted
      }
      return parseImm(token);
    };

    const resolveJumpOff = (token: string): number | null => {
      const label = labels.get(token);
      if (label !== undefined) {
        const rel = label - (currentAddr + 2);
        return rel >> 1;
      }
      return parseImm(token);
    };

    switch (mnemonic) {
      // R-format
      case "ADD": case "SUB": case "AND": case "OR": case "XOR":
      case "SLT": case "SLTU": {
        if (args.length !== 3) { err(`${mnemonic} expects 3 args`); emit(0); break; }
        const rd  = parseReg(args[0]);
        const rs1 = parseReg(args[1]);
        const rs2 = parseReg(args[2]);
        if (rd === null || rs1 === null || rs2 === null) { err("invalid register"); emit(0); break; }
        const funcMap: Record<string, number> = {
          ADD: Func.ADD, SUB: Func.SUB, AND: Func.AND, OR: Func.OR,
          XOR: Func.XOR, SLT: Func.SLT, SLTU: Func.SLTU,
        };
        emit(encodeR(rd, rs1, rs2, funcMap[mnemonic]));
        break;
      }

      case "JALR": {
        if (args.length !== 2) { err("JALR expects 2 args"); emit(0); break; }
        const rd  = parseReg(args[0]);
        const rs1 = parseReg(args[1]);
        if (rd === null || rs1 === null) { err("invalid register"); emit(0); break; }
        emit(encodeR(rd, rs1, 0b111, Func.SPECIAL));
        break;
      }

      // I-format
      case "ADDI": case "ANDI": case "ORI": case "XORI":
      case "SLLI": case "SRLI": case "SRAI": {
        if (args.length !== 3) { err(`${mnemonic} expects 3 args`); emit(0); break; }
        const rd  = parseReg(args[0]);
        const rs1 = parseReg(args[1]);
        const imm = parseImm(args[2]);
        if (rd === null || rs1 === null || imm === null) { err("invalid operand"); emit(0); break; }
        const opMap: Record<string, number> = {
          ADDI: Op.ADDI, ANDI: Op.ANDI, ORI: Op.ORI, XORI: Op.XORI,
          SLLI: Op.SLLI, SRLI: Op.SRLI, SRAI: Op.SRAI,
        };
        emit(encodeI(opMap[mnemonic], rd, rs1, imm));
        break;
      }

      // M-format
      case "LW": case "LB": {
        if (args.length !== 2) { err(`${mnemonic} expects 2 args`); emit(0); break; }
        const rd = parseReg(args[0]);
        const mem = parseMemOperand(args[1]);
        if (rd === null || mem === null) { err("invalid operand"); emit(0); break; }
        emit(encodeM(mnemonic === "LW" ? Op.LW : Op.LB, rd, mem.base, mem.imm));
        break;
      }

      case "SW": case "SB": {
        if (args.length !== 2) { err(`${mnemonic} expects 2 args`); emit(0); break; }
        const rs = parseReg(args[0]);
        const mem = parseMemOperand(args[1]);
        if (rs === null || mem === null) { err("invalid operand"); emit(0); break; }
        emit(encodeM(mnemonic === "SW" ? Op.SW : Op.SB, rs, mem.base, mem.imm));
        break;
      }

      // B-format
      case "BEQ": case "BNE": {
        if (args.length !== 3) { err(`${mnemonic} expects 3 args`); emit(0); break; }
        const rs1 = parseReg(args[0]);
        const rs2 = parseReg(args[1]);
        const off = resolveBranchOff(args[2]);
        if (rs1 === null || rs2 === null || off === null) { err("invalid operand"); emit(0); break; }
        emit(encodeB(mnemonic === "BEQ" ? Op.BEQ : Op.BNE, rs1, rs2, off));
        break;
      }

      // J-format
      case "JAL": {
        if (args.length !== 1) { err("JAL expects 1 arg"); emit(0); break; }
        const off = resolveJumpOff(args[0]);
        if (off === null) { err("invalid operand"); emit(0); break; }
        emit(encodeJ(off));
        break;
      }

      // SYS
      case "ECALL":  emit(encodeSys(Sys.ECALL));  break;
      case "EBREAK": emit(encodeSys(Sys.EBREAK)); break;
      case "ERET":   emit(encodeSys(Sys.ERET));   break;
      case "FENCE":  emit(encodeSys(Sys.FENCE));   break;

      case "CSRR": {
        if (args.length !== 2) { err("CSRR expects 2 args"); emit(0); break; }
        const rd  = parseReg(args[0]);
        const csr = parseImm(args[1]);
        if (rd === null || csr === null) { err("invalid operand"); emit(0); break; }
        emit(encodeSys(Sys.CSRR, rd, csr));
        break;
      }

      case "CSRW": {
        if (args.length !== 2) { err("CSRW expects 2 args"); emit(0); break; }
        const csr = parseImm(args[0]);
        const rs  = parseReg(args[1]);
        if (csr === null || rs === null) { err("invalid operand"); emit(0); break; }
        emit(encodeSys(Sys.CSRW, rs, csr));
        break;
      }

      // --- Pseudo-instructions ---
      case "NOP": emit(encodeR(0, 0, 0, Func.ADD)); break;
      case "MOV": {
        if (args.length !== 2) { err("MOV expects 2 args"); emit(0); break; }
        const rd = parseReg(args[0]);
        const rs = parseReg(args[1]);
        if (rd === null || rs === null) { err("invalid register"); emit(0); break; }
        emit(encodeR(rd, rs, 0, Func.ADD));
        break;
      }
      case "RET": emit(encodeR(0, 7, 0b111, Func.SPECIAL)); break;

      case "LI": {
        if (args.length !== 2) { err("LI expects 2 args"); emit(0); break; }
        const rd  = parseReg(args[0]);
        const imm = parseImm(args[1]);
        if (rd === null || imm === null) { err("invalid operand"); emit(0); break; }
        // Small constant path: fits in sign-extended 6-bit (-32..31)
        emit(encodeI(Op.ADDI, rd, 0, imm));
        break;
      }

      default:
        err(`unknown instruction: ${mnemonic}`);
        emit(0);
    }
  }

  return {
    program: new Uint16Array(words),
    labels,
    errors,
  };
}
