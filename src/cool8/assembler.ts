// cool8 assembler — converts assembly source to machine code

import { Op } from "./core";

export interface AssembleError {
  line: number;
  message: string;
}

export interface AssembleResult {
  program: Uint8Array;
  labels: Map<string, number>;
  errors: AssembleError[];
}

const REG_NAMES = {
  r0: 0,
  r1: 1,
  r2: 2,
  r3: 3,
} as const;

function parseReg(token: string): number | null {
  const normalized = token.trim().toLowerCase();
  const value = REG_NAMES[normalized as keyof typeof REG_NAMES];
  return value === undefined ? null : value;
}

function parseImm(token: string): number | null {
  const trimmed = token.trim();
  if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) {
    const value = Number.parseInt(trimmed, 16);
    return Number.isNaN(value) ? null : value;
  }
  if (trimmed.startsWith("0b") || trimmed.startsWith("0B")) {
    const value = Number.parseInt(trimmed.slice(2), 2);
    return Number.isNaN(value) ? null : value;
  }
  const value = Number.parseInt(trimmed, 10);
  return Number.isNaN(value) ? null : value;
}

function toU8(value: number): number {
  return value & 0xff;
}

function toSigned4(value: number): number {
  if (value < -8 || value > 7) return Number.NaN;
  const masked = value & 0xf;
  return masked;
}

function encodeR(op: number, rd: number, rs: number): number {
  return (op << 4) | ((rd & 3) << 2) | (rs & 3);
}

function encodeI(op: number, rd: number, imm: number): number {
  return (op << 4) | ((rd & 3) << 2) | (imm & 3);
}

function encodeB(op: number, off: number): number {
  return (op << 4) | (off & 0xf);
}

function resolveImmediate(
  token: string,
  labels: Map<string, number>,
): number | null {
  const label = labels.get(token);
  if (label !== undefined) {
    return label;
  }
  return parseImm(token);
}

export function tokenizeLine(raw: string): {
  label: string | null;
  mnemonic: string | null;
  args: string[];
} {
  const line = raw.split(/[#;]/)[0].trim();
  if (!line) {
    return { label: null, mnemonic: null, args: [] };
  }

  let rest = line;
  let label: string | null = null;

  const colonIdx = rest.indexOf(":");
  if (colonIdx >= 0) {
    label = rest.slice(0, colonIdx).trim();
    rest = rest.slice(colonIdx + 1).trim();
  }

  if (!rest) {
    return { label, mnemonic: null, args: [] };
  }

  const parts = rest.split(/\s+/);
  const mnemonic = parts[0].toUpperCase();
  const argStr = parts.slice(1).join(" ");

  const args: string[] = [];
  if (argStr) {
    for (const arg of argStr.split(",")) {
      if (arg.trim()) {
        args.push(arg.trim());
      }
    }
  }

  return { label, mnemonic, args };
}

export function assembleLine(
  mnemonic: string,
  args: string[],
  addr: number,
  labels: Map<string, number>,
): { byte: number; error?: string } {
  const fail = (message: string) => ({ byte: 0, error: message });

  const resolveBranch = (token: string): number | null => {
    const direct = resolveImmediate(token, labels);
    if (direct === null) return null;
    const off = direct - (addr + 1);
    const encoded = toSigned4(off);
    if (Number.isNaN(encoded)) return null;
    return encoded;
  };

  switch (mnemonic) {
    case "ADD":
    case "SUB":
    case "AND":
    case "OR":
    case "NOR": {
      if (args.length !== 2) return fail(`${mnemonic} expects 2 args`);
      const rd = parseReg(args[0]);
      const rs = parseReg(args[1]);
      if (rd === null || rs === null) {
        return fail("invalid register");
      }

      const opMap: Record<string, number> = {
        ADD: Op.ADD,
        SUB: Op.SUB,
        AND: Op.AND,
        OR: Op.OR,
        NOR: Op.NOR,
      };
      return { byte: encodeR(opMap[mnemonic], rd, rs) };
    }

    case "LDI": {
      if (args.length !== 2) return fail("LDI expects 2 args");
      const rd = parseReg(args[0]);
      const imm = resolveImmediate(args[1], labels);
      if (rd === null || imm === null) return fail("invalid operand");
      if (imm < 0 || imm > 3) return fail("LDI immediate must be 0..3");
      return { byte: encodeI(Op.LDI, rd, imm & 3) };
    }

    case "ADDI":
    case "SHL":
    case "SHR": {
      if (args.length !== 2) return fail(`${mnemonic} expects 2 args`);
      const rd = parseReg(args[0]);
      const imm = parseImm(args[1]);
      if (rd === null || imm === null) return fail("invalid operand");
      if (mnemonic === "ADDI") {
        if (imm < -2 || imm > 3) {
          return fail("ADDI immediate must be in range -2..3");
        }
      } else if (imm < 0 || imm > 3) {
        return fail(`${mnemonic} immediate must be in range 0..3`);
      }
      return { byte: encodeI(Op[mnemonic as keyof typeof Op], rd, imm & 3) };
    }

    case "LD":
    case "ST": {
      if (args.length !== 2) return fail(`${mnemonic} expects 2 args`);
      const rd = parseReg(args[0]);
      const rs = parseReg(args[1]);
      if (rd === null || rs === null) return fail("invalid register");
      return {
        byte:
          mnemonic === "LD" ? encodeR(Op.LD, rd, rs) : encodeR(Op.ST, rd, rs),
      };
    }

    case "BEQ":
    case "BNE":
    case "BCS": {
      if (args.length !== 1) return fail(`${mnemonic} expects 1 arg`);
      const off = resolveBranch(args[0]);
      if (off === null) return fail("invalid branch offset");
      const op =
        mnemonic === "BEQ" ? Op.BEQ : mnemonic === "BNE" ? Op.BNE : Op.BCS;
      return { byte: encodeB(op, off) };
    }

    case "JAL": {
      if (args.length !== 2) return fail("JAL expects 2 args");
      const rd = parseReg(args[0]);
      const rs = parseReg(args[1]);
      if (rd === null || rs === null) return fail("invalid register");
      return { byte: encodeR(Op.JAL, rd, rs) };
    }

    case "SYS": {
      if (args.length !== 0) return fail("SYS expects 0 args");
      return { byte: Op.SYS << 4 };
    }

    default:
      return fail(`unknown instruction: ${mnemonic}`);
  }
}

export function assemble(source: string): AssembleResult {
  const lines = source.split("\n");
  const errors: AssembleError[] = [];
  const labels = new Map<string, number>();

  const instructions: Array<{
    lineNum: number;
    mnemonic: string;
    args: string[];
    prefix: string;
  }> = [];

  let addr = 0;
  let currentPrefix = "";
  for (let i = 0; i < lines.length; i++) {
    const { label, mnemonic, args } = tokenizeLine(lines[i]);

    if (label !== null) {
      const isLocal = label.startsWith(".");
      const fullLabel = isLocal ? `${currentPrefix}${label}` : label;
      if (!isLocal) currentPrefix = label;

      if (labels.has(fullLabel)) {
        errors.push({ line: i + 1, message: `duplicate label: ${fullLabel}` });
      } else {
        labels.set(fullLabel, addr);
      }
    }

    if (mnemonic) {
      instructions.push({
        lineNum: i + 1,
        mnemonic,
        args,
        prefix: currentPrefix,
      });
      addr += 1;
    }
  }

  const bytes: number[] = [];
  for (const { lineNum, mnemonic, args, prefix } of instructions) {
    const currentAddr = bytes.length;
    const expandedArgs = args.map((arg) =>
      arg.startsWith(".") ? `${prefix}${arg}` : arg,
    );
    const result = assembleLine(mnemonic, expandedArgs, currentAddr, labels);
    if (result.error) {
      errors.push({ line: lineNum, message: result.error });
    }
    bytes.push(toU8(result.byte));
  }

  return {
    program: new Uint8Array(bytes),
    labels,
    errors,
  };
}
