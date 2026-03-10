// cool8 — 8-bit RISC educational CPU virtual machine

// --- Constants ---

export const REG_COUNT = 4;
export const MEM_SIZE = 0x100; // 256 bytes
export const RESET_SP = 0xdf;
export const MMIO_BASE = 0xf0;

export const Op = {
  ADD: 0x0,
  SUB: 0x1,
  AND: 0x2,
  OR: 0x3,
  NOR: 0x4,
  LDI: 0x5,
  ADDI: 0x6,
  SHL: 0x7,
  SHR: 0x8,
  LD: 0x9,
  ST: 0xa,
  BEQ: 0xb,
  BNE: 0xc,
  BCS: 0xd,
  JAL: 0xe,
  SYS: 0xf,
} as const;

export interface StepResult {
  pc: number;
  instr: number;
  running: boolean;
}

function sext(value: number, bits: number): number {
  const sign = 1 << (bits - 1);
  return (value ^ sign) - sign;
}

function toHex8(value: number): string {
  return `0x${(value & 0xff).toString(16).padStart(2, "0")}`;
}

function regName(index: number): string {
  return `r${index}`;
}

export class Cool8 {
  regs = new Uint8Array(REG_COUNT);
  mem = new Uint8Array(MEM_SIZE);
  pc = 0;
  halted = false;
  cycles = 0;

  z = 1;
  c = 0;

  onSys: (() => void) | null = null;
  onMmioWrite: ((addr: number, value: number) => void) | null = null;

  constructor() {
    this.reset();
  }

  /** Load a program into memory starting from byte address `addr`. */
  load(program: Uint8Array | number[], addr = 0): void {
    let p = addr & 0xff;
    for (const raw of program) {
      this.mem[p] = raw & 0xff;
      p = (p + 1) & 0xff;
    }
  }

  /** Reset all CPU-visible state. */
  reset(): void {
    this.regs.fill(0);
    this.mem.fill(0);
    this.regs[3] = RESET_SP;
    this.pc = 0;
    this.halted = false;
    this.cycles = 0;
    this.z = 1;
    this.c = 0;
  }

  /** Read one byte, including MMIO read path. */
  read8(addr: number): number {
    const a = addr & 0xff;
    if (a >= MMIO_BASE) {
      return 0;
    }
    return this.mem[a];
  }

  /** Write one byte, including MMIO write callback for UART-like output. */
  write8(addr: number, value: number): void {
    const a = addr & 0xff;
    const v = value & 0xff;
    if (a >= MMIO_BASE) {
      this.onMmioWrite?.(a, v);
      return;
    }
    this.mem[a] = v;
  }

  /** Set register value while keeping `r0 = 0`. */
  private setReg(index: number, value: number): void {
    if (index !== 0) {
      this.regs[index] = value & 0xff;
    }
  }

  private setZ(value: number): void {
    this.z = (value & 0xff) === 0 ? 1 : 0;
  }

  private setFlagsFromAdd(sum: number): void {
    this.c = sum > 0xff ? 1 : 0;
    this.setZ(sum & 0xff);
  }

  private setFlagsFromSub(a: number, b: number, diff: number): void {
    this.c = a >= b ? 1 : 0;
    this.setZ(diff);
  }

  private setFlagsFromLogical(value: number): void {
    this.c = 0;
    this.setZ(value);
  }

  /** Execute one instruction and return pre-execution state. */
  step(): StepResult {
    const pc = this.pc & 0xff;
    if (this.halted) {
      return { pc, instr: this.read8(pc), running: false };
    }

    const instr = this.read8(pc);
    this.cycles++;

    const op = (instr >> 4) & 0xf;
    const rd = (instr >> 2) & 0x3;
    const rs = instr & 0x3;
    let nextPc = (pc + 1) & 0xff;

    switch (op) {
      case Op.ADD: {
        const sum = this.regs[rd] + this.regs[rs];
        this.setReg(rd, sum);
        this.setFlagsFromAdd(sum);
        break;
      }
      case Op.SUB: {
        const a = this.regs[rd];
        const b = this.regs[rs];
        const diff = (a - b) & 0xff;
        this.setReg(rd, diff);
        this.setFlagsFromSub(a, b, diff);
        break;
      }
      case Op.AND: {
        const value = this.regs[rd] & this.regs[rs];
        this.setReg(rd, value);
        this.setFlagsFromLogical(value);
        break;
      }
      case Op.OR: {
        const value = this.regs[rd] | this.regs[rs];
        this.setReg(rd, value);
        this.setFlagsFromLogical(value);
        break;
      }
      case Op.NOR: {
        const value = ~(this.regs[rd] | this.regs[rs]);
        this.setReg(rd, value);
        this.setFlagsFromLogical(value);
        break;
      }
      case Op.LDI: {
        const value = rs & 0x3;
        this.setReg(rd, value);
        this.setZ(value);
        break;
      }
      case Op.ADDI: {
        const imm = sext(rs, 2);
        const sum = this.regs[rd] + imm;
        this.setReg(rd, sum);
        this.setFlagsFromAdd(sum);
        break;
      }
      case Op.SHL: {
        const value = this.regs[rd] << rs;
        this.setReg(rd, value);
        this.setFlagsFromLogical(value);
        break;
      }
      case Op.SHR: {
        const value = this.regs[rd] >>> rs;
        this.setReg(rd, value);
        this.setFlagsFromLogical(value);
        break;
      }
      case Op.LD: {
        this.setReg(rd, this.read8(this.regs[rs]));
        this.setFlagsFromLogical(this.regs[rd]);
        break;
      }
      case Op.ST: {
        this.write8(this.regs[rd], this.regs[rs]);
        break;
      }
      case Op.BEQ: {
        const off = sext(instr & 0xf, 4);
        if (this.z === 1) {
          nextPc = (nextPc + off) & 0xff;
        }
        break;
      }
      case Op.BNE: {
        const off = sext(instr & 0xf, 4);
        if (this.z === 0) {
          nextPc = (nextPc + off) & 0xff;
        }
        break;
      }
      case Op.BCS: {
        const off = sext(instr & 0xf, 4);
        if (this.c === 1) {
          nextPc = (nextPc + off) & 0xff;
        }
        break;
      }
      case Op.JAL: {
        const target = this.regs[rs];
        this.setReg(rd, nextPc);
        nextPc = target;
        break;
      }
      case Op.SYS:
        this.onSys?.();
        this.halted = true;
        break;
      default:
        this.halted = true;
        break;
    }

    this.pc = nextPc;
    return { pc, instr, running: !this.halted };
  }

  /** Run up to `maxCycles` instructions and return executed cycles. */
  run(maxCycles = 1_000_000): number {
    const start = this.cycles;
    while (this.cycles - start < maxCycles) {
      const step = this.step();
      if (!step.running) {
        break;
      }
    }
    return this.cycles - start;
  }

  dump(): string {
    const regs = [];
    for (let i = 0; i < REG_COUNT; i++) {
      regs.push(`${regName(i)}=${toHex8(this.regs[i])}`);
    }
    regs.push(`pc=${toHex8(this.pc)} z=${this.z} c=${this.c}`);
    return regs.join(" ");
  }
}
