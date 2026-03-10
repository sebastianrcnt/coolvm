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

// Resolve an immediate: check constants map, then labels map, then parse as number.
function resolveImm(
  token: string,
  constants: Map<string, number>,
  labels?: Map<string, number>,
): number | null {
  const t = token.trim();
  const c = constants.get(t);
  if (c !== undefined) return c;
  if (labels) {
    const l = labels.get(t);
    if (l !== undefined) return l;
  }
  return parseImm(t);
}

function toU16(value: number): number {
  return value & 0xFFFF;
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

// --- String literal parsing ---

// Parses a quoted string literal (e.g. `"Hello\n\0"`) into a byte array.
// Supports escape sequences: \n, \t, \r, \0, \\, \"
export function parseStringLiteral(token: string): number[] {
  const inner = token.trim();
  if (!inner.startsWith('"') || !inner.endsWith('"')) return [];
  const s = inner.slice(1, -1);
  const bytes: number[] = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === "\\" && i + 1 < s.length) {
      switch (s[i + 1]) {
        case "n":  bytes.push(10); break;
        case "t":  bytes.push(9);  break;
        case "r":  bytes.push(13); break;
        case "0":  bytes.push(0);  break;
        case "\\": bytes.push(92); break;
        case '"':  bytes.push(34); break;
        default:   bytes.push(s.charCodeAt(i + 1)); break;
      }
      i += 2;
    } else {
      bytes.push(s.charCodeAt(i));
      i++;
    }
  }
  return bytes;
}

// --- Byte count estimation for pass 1 ---

// Returns the number of bytes an instruction or directive will emit.
function instrByteCount(mnemonic: string, args: string[]): number {
  switch (mnemonic) {
    case "NOT": case "SEQZ": case "PUSH": case "POP":
      return 4;
    case "LI": {
      if (args.length >= 2) {
        const imm = parseImm(args[1]);
        if (imm !== null && imm >= -32 && imm <= 31) return 2;
      }
      return 10;
    }
    case ".BYTE":
      return Math.ceil(args.length / 2) * 2;
    case ".ASCII": {
      const str = args.join(","); // rejoin in case string was split on commas
      const bytes = parseStringLiteral(str);
      return Math.ceil(bytes.length / 2) * 2;
    }
    default:
      return 2;
  }
}

// --- Data directive encoding ---

// Encodes .byte or .ascii directives into u16 word arrays (little-endian pairs).
function encodeData(mnemonic: string, args: string[]): { words: number[]; error?: string } {
  const bytes: number[] = [];

  if (mnemonic === ".BYTE") {
    for (const arg of args) {
      const v = parseImm(arg.trim());
      if (v === null) return { words: [], error: `invalid byte value: ${arg}` };
      bytes.push(v & 0xFF);
    }
  } else if (mnemonic === ".ASCII") {
    const str = args.join(","); // rejoin in case string was split on commas
    const parsed = parseStringLiteral(str);
    bytes.push(...parsed);
  } else {
    return { words: [], error: `unknown data directive: ${mnemonic}` };
  }

  // Pack bytes as little-endian u16 words, padding with 0x00 if odd
  const words: number[] = [];
  for (let i = 0; i < bytes.length; i += 2) {
    const lo = bytes[i];
    const hi = i + 1 < bytes.length ? bytes[i + 1] : 0;
    words.push((hi << 8) | lo);
  }
  return { words };
}

// --- Tokenizer ---

export function tokenizeLine(raw: string): { label: string | null; mnemonic: string | null; args: string[] } {
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

  // Split args on commas, but not inside quoted strings
  const args: string[] = [];
  if (argStr) {
    let current = "";
    let inQuote = false;
    for (const ch of argStr) {
      if (ch === '"') {
        inQuote = !inQuote;
        current += ch;
      } else if (ch === "," && !inQuote) {
        args.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    if (current.trim()) args.push(current.trim());
  }

  return { label, mnemonic, args };
}

export function assembleLine(
  mnemonic: string,
  args: string[],
  addr: number,
  labels: Map<string, number>,
  constants: Map<string, number> = new Map(),
): { words: number[]; error?: string } {
  const words: number[] = [];
  const emit = (word: number) => words.push(word & 0xFFFF);
  const fail = (error: string) => ({ words: words.length > 0 ? words : [0], error });

  const resolveBranchOff = (token: string): number | null => {
    const label = labels.get(token);
    if (label !== undefined) {
      const rel = label - (addr + 2);
      return rel >> 1;
    }
    return parseImm(token);
  };

  const resolveJumpOff = (token: string): number | null => {
    const label = labels.get(token);
    if (label !== undefined) {
      const rel = label - (addr + 2);
      return rel >> 1;
    }
    return parseImm(token);
  };

  switch (mnemonic) {
    case "ADD": case "SUB": case "AND": case "OR": case "XOR":
    case "SLT": case "SLTU": {
      if (args.length !== 3) return fail(`${mnemonic} expects 3 args`);
      const rd  = parseReg(args[0]);
      const rs1 = parseReg(args[1]);
      const rs2 = parseReg(args[2]);
      if (rd === null || rs1 === null || rs2 === null) return fail("invalid register");
      const funcMap: Record<string, number> = {
        ADD: Func.ADD, SUB: Func.SUB, AND: Func.AND, OR: Func.OR,
        XOR: Func.XOR, SLT: Func.SLT, SLTU: Func.SLTU,
      };
      emit(encodeR(rd, rs1, rs2, funcMap[mnemonic]));
      break;
    }

    case "JALR": {
      if (args.length !== 2) return fail("JALR expects 2 args");
      const rd  = parseReg(args[0]);
      const rs1 = parseReg(args[1]);
      if (rd === null || rs1 === null) return fail("invalid register");
      emit(encodeR(rd, rs1, 0b111, Func.SPECIAL));
      break;
    }

    case "ADDI": case "ANDI": case "ORI": case "XORI":
    case "SLLI": case "SRLI": case "SRAI": {
      if (args.length !== 3) return fail(`${mnemonic} expects 3 args`);
      const rd  = parseReg(args[0]);
      const rs1 = parseReg(args[1]);
      const imm = resolveImm(args[2], constants);
      if (rd === null || rs1 === null || imm === null) return fail("invalid operand");
      const opMap: Record<string, number> = {
        ADDI: Op.ADDI, ANDI: Op.ANDI, ORI: Op.ORI, XORI: Op.XORI,
        SLLI: Op.SLLI, SRLI: Op.SRLI, SRAI: Op.SRAI,
      };
      emit(encodeI(opMap[mnemonic], rd, rs1, imm));
      break;
    }

    case "LW": case "LB": {
      if (args.length !== 2) return fail(`${mnemonic} expects 2 args`);
      const rd = parseReg(args[0]);
      const mem = parseMemOperand(args[1]);
      if (rd === null || mem === null) return fail("invalid operand");
      emit(encodeM(mnemonic === "LW" ? Op.LW : Op.LB, rd, mem.base, mem.imm));
      break;
    }

    case "SW": case "SB": {
      if (args.length !== 2) return fail(`${mnemonic} expects 2 args`);
      const rs = parseReg(args[0]);
      const mem = parseMemOperand(args[1]);
      if (rs === null || mem === null) return fail("invalid operand");
      emit(encodeM(mnemonic === "SW" ? Op.SW : Op.SB, rs, mem.base, mem.imm));
      break;
    }

    case "BEQ": case "BNE": {
      if (args.length !== 3) return fail(`${mnemonic} expects 3 args`);
      const rs1 = parseReg(args[0]);
      const rs2 = parseReg(args[1]);
      const off = resolveBranchOff(args[2]);
      if (rs1 === null || rs2 === null || off === null) return fail("invalid operand");
      emit(encodeB(mnemonic === "BEQ" ? Op.BEQ : Op.BNE, rs1, rs2, off));
      break;
    }

    case "JAL": {
      if (args.length !== 1) return fail("JAL expects 1 arg");
      const off = resolveJumpOff(args[0]);
      if (off === null) return fail("invalid operand");
      emit(encodeJ(off));
      break;
    }

    case "ECALL": emit(encodeSys(Sys.ECALL)); break;
    case "EBREAK": emit(encodeSys(Sys.EBREAK)); break;
    case "ERET": emit(encodeSys(Sys.ERET)); break;
    case "FENCE": emit(encodeSys(Sys.FENCE)); break;

    case "CSRR": {
      if (args.length !== 2) return fail("CSRR expects 2 args");
      const rd  = parseReg(args[0]);
      const csr = resolveImm(args[1], constants);
      if (rd === null || csr === null) return fail("invalid operand");
      emit(encodeSys(Sys.CSRR, rd, csr));
      break;
    }

    case "CSRW": {
      if (args.length !== 2) return fail("CSRW expects 2 args");
      const csr = resolveImm(args[0], constants);
      const rs  = parseReg(args[1]);
      if (csr === null || rs === null) return fail("invalid operand");
      emit(encodeSys(Sys.CSRW, rs, csr));
      break;
    }

    case "NOP":
      emit(encodeR(0, 0, 0, Func.ADD));
      break;
    case "MOV": {
      if (args.length !== 2) return fail("MOV expects 2 args");
      const rd = parseReg(args[0]);
      const rs = parseReg(args[1]);
      if (rd === null || rs === null) return fail("invalid register");
      emit(encodeR(rd, rs, 0, Func.ADD));
      break;
    }
    case "RET":
      emit(encodeR(0, 7, 0b111, Func.SPECIAL));
      break;
    case "NEG": {
      if (args.length !== 2) return fail("NEG expects 2 args");
      const rd = parseReg(args[0]);
      const rs = parseReg(args[1]);
      if (rd === null || rs === null) return fail("invalid register");
      emit(encodeR(rd, 0, rs, Func.SUB));
      break;
    }
    case "NOT": {
      if (args.length !== 2) return fail("NOT expects 2 args");
      const rd = parseReg(args[0]);
      const rs = parseReg(args[1]);
      if (rd === null || rs === null) return fail("invalid register");
      emit(encodeR(rd, 0, rs, Func.SUB));
      emit(encodeI(Op.ADDI, rd, rd, -1));
      break;
    }
    case "JR": {
      if (args.length !== 1) return fail("JR expects 1 arg");
      const rs = parseReg(args[0]);
      if (rs === null) return fail("invalid register");
      emit(encodeR(0, rs, 0b111, Func.SPECIAL));
      break;
    }
    case "SUBI": {
      if (args.length !== 3) return fail("SUBI expects 3 args");
      const rd = parseReg(args[0]);
      const rs = parseReg(args[1]);
      const imm = resolveImm(args[2], constants);
      if (rd === null || rs === null || imm === null) return fail("invalid operand");
      emit(encodeI(Op.ADDI, rd, rs, -imm));
      break;
    }
    case "SEQZ": {
      if (args.length !== 2) return fail("SEQZ expects 2 args");
      const rd = parseReg(args[0]);
      const rs = parseReg(args[1]);
      if (rd === null || rs === null) return fail("invalid register");
      emit(encodeR(rd, 0, rs, Func.SLTU));
      emit(encodeI(Op.XORI, rd, rd, 1));
      break;
    }
    case "SNEZ": {
      if (args.length !== 2) return fail("SNEZ expects 2 args");
      const rd = parseReg(args[0]);
      const rs = parseReg(args[1]);
      if (rd === null || rs === null) return fail("invalid register");
      emit(encodeR(rd, 0, rs, Func.SLTU));
      break;
    }
    case "PUSH": {
      if (args.length !== 1) return fail("PUSH expects 1 arg");
      const rs = parseReg(args[0]);
      if (rs === null) return fail("invalid register");
      emit(encodeI(Op.ADDI, 6, 6, -2));
      emit(encodeM(Op.SW, rs, 6, 0));
      break;
    }
    case "POP": {
      if (args.length !== 1) return fail("POP expects 1 arg");
      const rd = parseReg(args[0]);
      if (rd === null) return fail("invalid register");
      emit(encodeM(Op.LW, rd, 6, 0));
      emit(encodeI(Op.ADDI, 6, 6, 2));
      break;
    }
    case "CALL":
    case "JMP": {
      if (args.length !== 1) return fail(`${mnemonic} expects 1 arg`);
      const off = resolveJumpOff(args[0]);
      if (off === null) return fail("invalid operand");
      emit(encodeJ(off));
      break;
    }

    case "LI": {
      if (args.length !== 2) return fail("LI expects 2 args");
      const rd  = parseReg(args[0]);
      const imm = resolveImm(args[1], constants, labels);
      if (rd === null || imm === null) return fail("invalid operand");
      // Short form only when arg is a numeric literal in range.
      // Symbolic args (labels/constants) always use the large 5-instruction form
      // so that pass 1 byte-count estimation (which also can't resolve symbols) stays consistent.
      const isNumericLiteral = parseImm(args[1]) !== null;
      if (isNumericLiteral && imm >= -32 && imm <= 31) {
        emit(encodeI(Op.ADDI, rd, 0, imm));
        break;
      }
      const value = toU16(imm);
      const signed = (value << 16) >> 16;
      const top6 = signed >> 10;
      const mid6 = (value >> 4) & 0x3F;
      const low4 = value & 0xF;
      emit(encodeI(Op.ADDI, rd, 0, top6));
      emit(encodeI(Op.SLLI, rd, rd, 6));
      emit(encodeI(Op.ORI, rd, rd, mid6));
      emit(encodeI(Op.SLLI, rd, rd, 4));
      emit(encodeI(Op.ORI, rd, rd, low4));
      break;
    }

    default:
      return fail(`unknown instruction: ${mnemonic}`);
  }

  return { words };
}

// --- Assembler (two-pass) ---

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
    prefix: string; // current global label prefix at time of this instruction
  }> = [];

  // --- Pass 1: collect labels and constants, compute addresses ---
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
        // .equ NAME, value — store constant, no address increment
        if (args.length === 2) {
          const val = parseImm(args[1].trim());
          if (val !== null) {
            constants.set(args[0].trim(), val);
          } else {
            errors.push({ line: i + 1, message: `invalid constant value: ${args[1]}` });
          }
        } else {
          errors.push({ line: i + 1, message: ".equ expects NAME, value" });
        }
      } else {
        const isData = mnemonic === ".BYTE" || mnemonic === ".ASCII";
        instructions.push({ lineNum: i + 1, mnemonic, args, isData, prefix: currentPrefix });
        addr += instrByteCount(mnemonic, args);
      }
    }
  }

  // --- Pass 2: encode instructions ---
  const words: number[] = [];

  for (const { lineNum, mnemonic, args, isData, prefix } of instructions) {
    const currentAddr = words.length * 2;

    // Expand local label references in args (e.g. ".loop" → "fib.loop")
    const expandedArgs = args.map((arg) =>
      arg.startsWith(".") ? `${prefix}${arg}` : arg,
    );

    if (isData) {
      const result = encodeData(mnemonic, expandedArgs);
      if (result.error) {
        errors.push({ line: lineNum, message: result.error });
      }
      words.push(...result.words.map((w) => w & 0xFFFF));
    } else {
      const result = assembleLine(mnemonic, expandedArgs, currentAddr, labels, constants);
      if (result.error) {
        errors.push({ line: lineNum, message: result.error });
      }
      words.push(...result.words.map((w) => w & 0xFFFF));
    }
  }

  return {
    program: new Uint16Array(words),
    labels,
    errors,
  };
}
