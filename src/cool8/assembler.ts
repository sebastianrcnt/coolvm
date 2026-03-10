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

function toSigned2(value: number): number {
  if (value < -2 || value > 1) return Number.NaN;
  const masked = value & 0x3;
  return masked;
}

function encodeR(op: number, rd: number, rs: number): number {
  return (op << 4) | ((rd & 3) << 2) | (rs & 3);
}

function encodeI(op: number, rd: number, imm: number): number {
  return (op << 4) | ((rd & 3) << 2) | (imm & 3);
}

function encodeB(op: number, rs: number, off: number): number {
  return (op << 4) | ((rs & 3) << 2) | (off & 0x3);
}

function resolveImmediate(
  token: string,
  labels: Map<string, number>,
  constants: Map<string, number>,
): number | null {
  const label = labels.get(token);
  if (label !== undefined) {
    return label;
  }
  const constant = constants.get(token);
  if (constant !== undefined) {
    return constant;
  }
  return parseImm(token);
}

function parseStringLiteral(token: string): number[] | null {
  const inner = token.trim();
  if (!inner.startsWith('"') || !inner.endsWith('"')) {
    return null;
  }

  const s = inner.slice(1, -1);
  const bytes: number[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\\" && i + 1 < s.length) {
      const next = s[i + 1];
      switch (next) {
        case "n":
          bytes.push(10);
          break;
        case "t":
          bytes.push(9);
          break;
        case "r":
          bytes.push(13);
          break;
        case "0":
          bytes.push(0);
          break;
        case "\\":
          bytes.push(92);
          break;
        case '"':
          bytes.push(34);
          break;
        default:
          bytes.push(next.charCodeAt(0));
      }
      i += 2;
      continue;
    }

    bytes.push(ch.charCodeAt(0));
    i += 1;
  }

  return bytes;
}

function encodeDataDirective(
  mnemonic: string,
  args: string[],
  labels: Map<string, number>,
  constants: Map<string, number>,
): number[] | null {
  if (mnemonic === ".BYTE") {
    if (args.length === 0) return null;
    const bytes: number[] = [];
    for (const arg of args) {
      const value = resolveImmediate(arg, labels, constants);
      if (value === null) {
        return null;
      }
      bytes.push(value & 0xff);
    }
    return bytes;
  }

  if (mnemonic === ".ASCII") {
    if (args.length !== 1) return null;
    return parseStringLiteral(args.join(","));
  }

  return null;
}

function dataDirectiveSize(mnemonic: string, args: string[]): number {
  if (mnemonic === ".BYTE") {
    return args.length;
  }
  if (mnemonic === ".ASCII") {
    const bytes = parseStringLiteral(args.join(","));
    return bytes === null ? 0 : bytes.length;
  }
  return 1;
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
    let current = "";
    let inQuote = false;
    for (const ch of argStr) {
      if (ch === '"') {
        inQuote = !inQuote;
        current += ch;
      } else if (ch === "," && !inQuote) {
        if (current.trim()) {
          args.push(current.trim());
        }
        current = "";
      } else {
        current += ch;
      }
    }
    if (current.trim()) {
      args.push(current.trim());
    }
  }

  return { label, mnemonic, args };
}

export function assembleLine(
  mnemonic: string,
  args: string[],
  addr: number,
  labels: Map<string, number>,
  constants: Map<string, number>,
): { bytes: number[]; error?: string } {
  const fail = (message: string) => ({ bytes: [0], error: message });

  const resolveBranch = (token: string): number | null => {
    const direct = resolveImmediate(token, labels, constants);
    if (direct === null) return null;
    const off = direct - (addr + 1);
    const encoded = toSigned2(off);
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
      return { bytes: [encodeR(opMap[mnemonic], rd, rs)] };
    }

    case "LDI": {
      if (args.length !== 2) return fail("LDI expects 2 args");
      const rd = parseReg(args[0]);
      const imm = resolveImmediate(args[1], labels, constants);
      if (rd === null || imm === null) return fail("invalid operand");
      if (imm < 0 || imm > 3) return fail("LDI immediate must be 0..3");
      return { bytes: [encodeI(Op.LDI, rd, imm & 3)] };
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
      return { bytes: [encodeI(Op[mnemonic as keyof typeof Op], rd, imm & 3)] };
    }

    case "LD":
    case "ST": {
      if (args.length !== 2) return fail(`${mnemonic} expects 2 args`);
      const rd = parseReg(args[0]);
      const rs = parseReg(args[1]);
      if (rd === null || rs === null) return fail("invalid register");
      return {
        bytes: [
          mnemonic === "LD" ? encodeR(Op.LD, rd, rs) : encodeR(Op.ST, rd, rs),
        ],
      };
    }

    case "BEZ":
    case "BNZ": {
      if (args.length !== 2) return fail(`${mnemonic} expects 2 args`);
      const rs = parseReg(args[0]);
      const off = resolveBranch(args[1]);
      if (rs === null) {
        return fail("invalid register");
      }
      if (off === null) return fail("invalid branch offset");
      const op = mnemonic === "BEZ" ? Op.BEZ : Op.BNZ;
      return { bytes: [encodeB(op, rs, off)] };
    }

    case "JAL": {
      if (args.length !== 2) return fail("JAL expects 2 args");
      const rd = parseReg(args[0]);
      const rs = parseReg(args[1]);
      if (rd === null || rs === null) return fail("invalid register");
      return { bytes: [encodeR(Op.JAL, rd, rs)] };
    }

    case "SYS": {
      if (args.length !== 0) return fail("SYS expects 0 args");
      return { bytes: [Op.SYS << 4] };
    }

    default:
      return fail(`unknown instruction: ${mnemonic}`);
  }
}

export function assemble(source: string): AssembleResult {
  const lines = source.split("\n");
  const errors: AssembleError[] = [];
  const labels = new Map<string, number>();
  const constants = new Map<string, number>();

  const instructions: Array<{
    lineNum: number;
    mnemonic: string;
    args: string[];
    isData: boolean;
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
      if (mnemonic === ".EQU") {
        if (args.length !== 2) {
          errors.push({ line: i + 1, message: ".EQU expects NAME, value" });
          continue;
        }

        const name = args[0];
        const value = resolveImmediate(args[1], labels, constants);
        if (value === null) {
          errors.push({
            line: i + 1,
            message: `invalid .EQU value: ${args[1]}`,
          });
          continue;
        }

        if (constants.has(name)) {
          errors.push({ line: i + 1, message: `duplicate constant: ${name}` });
          continue;
        }

        constants.set(name, value);
        continue;
      }

      const isData = mnemonic === ".BYTE" || mnemonic === ".ASCII";
      instructions.push({
        lineNum: i + 1,
        mnemonic,
        args,
        isData,
        prefix: currentPrefix,
      });
      addr += isData ? dataDirectiveSize(mnemonic, args) : 1;
    }
  }

  const bytes: number[] = [];
  for (const { lineNum, mnemonic, args, isData, prefix } of instructions) {
    const currentAddr = bytes.length;
    const expandedArgs = args.map((arg) =>
      arg.startsWith(".") ? `${prefix}${arg}` : arg,
    );

    if (isData) {
      const result = encodeDataDirective(
        mnemonic,
        expandedArgs,
        labels,
        constants,
      );
      if (result === null) {
        errors.push({
          line: lineNum,
          message: `invalid ${mnemonic} directive`,
        });
        continue;
      }
      bytes.push(...result);
      continue;
    }

    const assembled = assembleLine(
      mnemonic,
      expandedArgs,
      currentAddr,
      labels,
      constants,
    );
    if (assembled.error) {
      errors.push({ line: lineNum, message: assembled.error });
    }
    bytes.push(...assembled.bytes.map(toU8));
  }

  return {
    program: new Uint8Array(bytes),
    labels,
    errors,
  };
}
