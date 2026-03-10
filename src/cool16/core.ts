// cool16 — 16-bit RISC virtual machine
// See specs/cool16.md for the full ISA specification.

// --- Constants ---

const NUM_REGS = 8;
const MEM_SIZE = 0x10000; // 64 KiB

// Opcodes (4-bit, bits 15:12)
export const Op = {
  ALU:  0x0,
  ADDI: 0x1,
  ANDI: 0x2,
  ORI:  0x3,
  XORI: 0x4,
  SLLI: 0x5,
  SRLI: 0x6,
  SRAI: 0x7,
  LW:   0x8,
  SW:   0x9,
  JAL:  0xA,
  SYS:  0xB,
  LB:   0xC,
  SB:   0xD,
  BEQ:  0xE,
  BNE:  0xF,
} as const;

// R-format func field (3-bit, bits 2:0)
export const Func = {
  ADD:  0b000,
  SUB:  0b001,
  AND:  0b010,
  OR:   0b011,
  XOR:  0b100,
  SLT:  0b101,
  SLTU: 0b110,
  SPECIAL: 0b111,
} as const;

// SYS sub-opcodes (3-bit, bits 11:9)
export const Sys = {
  ECALL:  0b000,
  EBREAK: 0b001,
  ERET:   0b010,
  FENCE:  0b011,
  CSRR:   0b100,
  CSRW:   0b101,
} as const;

// Trap causes
export const Cause = {
  ILLEGAL_INSTRUCTION: 0,
  MISALIGNED_ACCESS:   1,
  ECALL_USER:          2,
  ECALL_SUPERVISOR:    3,
  BREAKPOINT:          4,
  EXTERNAL_INTERRUPT:  5,
} as const;

// CSR addresses
export const Csr = {
  STATUS:  0x00,
  ESTATUS: 0x01,
  EPC:     0x02,
  CAUSE:   0x03,
  IVEC:    0x04,
} as const;

// STATUS register bits
const STATUS_IE   = 1 << 0; // interrupt enable
const STATUS_PRIV = 1 << 1; // privilege: 0=User, 1=Supervisor

// --- Helpers ---

/** Sign-extend a value of `bits` width to 16 bits. */
function sext(value: number, bits: number): number {
  const mask = 1 << (bits - 1);
  return ((value ^ mask) - mask) & 0xFFFF;
}

/** Interpret a u16 as a signed i16. */
function i16(value: number): number {
  return (value << 16) >> 16;
}

// --- VM ---

export type EcallHandler = (vm: Cool16) => void;

export interface StepResult {
  pc: number;
  instr: number;
  running: boolean;
}

export class Cool16 {
  regs = new Uint16Array(NUM_REGS);
  mem  = new Uint8Array(MEM_SIZE);
  pc   = 0;
  halted = false;
  cycles = 0;

  // CSRs
  csrs = new Uint16Array(64);

  // Callbacks
  onEcall: EcallHandler = () => { this.halted = true; };
  onEbreak: (() => void) | null = null;

  constructor() {
    // Start in supervisor mode with interrupts disabled
    this.csrs[Csr.STATUS] = STATUS_PRIV;
  }

  /** Load a program (array of 16-bit words) into memory starting at `addr`. */
  load(program: Uint16Array | number[], addr = 0): void {
    for (let i = 0; i < program.length; i++) {
      const word = typeof program[i] === "number" ? program[i] : program[i];
      this.mem[addr + i * 2]     = word & 0xFF;
      this.mem[addr + i * 2 + 1] = (word >> 8) & 0xFF;
    }
  }

  /** Read a 16-bit word from memory (little-endian). */
  read16(addr: number): number {
    return this.mem[addr & 0xFFFF] | (this.mem[(addr + 1) & 0xFFFF] << 8);
  }

  /** Write a 16-bit word to memory (little-endian). */
  write16(addr: number, value: number): void {
    this.mem[addr & 0xFFFF] = value & 0xFF;
    this.mem[(addr + 1) & 0xFFFF] = (value >> 8) & 0xFF;
  }

  /** Read an 8-bit byte from memory. */
  read8(addr: number): number {
    return this.mem[addr & 0xFFFF];
  }

  /** Write an 8-bit byte to memory. */
  write8(addr: number, value: number): void {
    this.mem[addr & 0xFFFF] = value & 0xFF;
  }

  private get inSupervisorMode(): boolean {
    return (this.csrs[Csr.STATUS] & STATUS_PRIV) !== 0;
  }

  /** Raise a trap (exception). */
  private trap(cause: number): void {
    this.csrs[Csr.EPC] = this.pc;
    this.csrs[Csr.ESTATUS] = this.csrs[Csr.STATUS];
    this.csrs[Csr.CAUSE] = cause;
    // Disable interrupts, enter supervisor mode
    this.csrs[Csr.STATUS] = (this.csrs[Csr.STATUS] & ~STATUS_IE) | STATUS_PRIV;
    this.pc = (this.csrs[Csr.IVEC] + (cause << 1)) & 0xFFFF;
  }

  /** Set a register value, enforcing r0 = 0. */
  private setReg(rd: number, value: number): void {
    if (rd !== 0) {
      this.regs[rd] = value & 0xFFFF;
    }
  }

  /** Execute a single instruction and return the pre-execution state. */
  step(): StepResult {
    const pc = this.pc;
    const instr = this.read16(pc);
    if (this.halted) {
      return { pc, instr, running: false };
    }

    this.cycles++;
    const op  = (instr >> 12) & 0xF;
    let nextPc = (this.pc + 2) & 0xFFFF;

    switch (op) {
      case Op.ALU: {
        const rd   = (instr >> 9) & 0x7;
        const rs1  = (instr >> 6) & 0x7;
        const rs2  = (instr >> 3) & 0x7;
        const func = instr & 0x7;
        const a = this.regs[rs1];
        const b = this.regs[rs2];

        switch (func) {
          case Func.ADD:  this.setReg(rd, a + b); break;
          case Func.SUB:  this.setReg(rd, a - b); break;
          case Func.AND:  this.setReg(rd, a & b); break;
          case Func.OR:   this.setReg(rd, a | b); break;
          case Func.XOR:  this.setReg(rd, a ^ b); break;
          case Func.SLT:  this.setReg(rd, i16(a) < i16(b) ? 1 : 0); break;
          case Func.SLTU: this.setReg(rd, a < b ? 1 : 0); break;
          case Func.SPECIAL: {
            // JALR: op=0000, rs2=111, func=111
            if (rs2 === 0b111) {
              this.setReg(rd, nextPc);
              nextPc = this.regs[rs1];
            } else {
              this.trap(Cause.ILLEGAL_INSTRUCTION);
              return { pc, instr, running: true };
            }
            break;
          }
        }
        break;
      }

      case Op.ADDI: {
        const rd  = (instr >> 9) & 0x7;
        const rs1 = (instr >> 6) & 0x7;
        const imm = sext(instr & 0x3F, 6);
        this.setReg(rd, this.regs[rs1] + imm);
        break;
      }

      case Op.ANDI: {
        const rd  = (instr >> 9) & 0x7;
        const rs1 = (instr >> 6) & 0x7;
        const imm = instr & 0x3F; // zero-extended
        this.setReg(rd, this.regs[rs1] & imm);
        break;
      }

      case Op.ORI: {
        const rd  = (instr >> 9) & 0x7;
        const rs1 = (instr >> 6) & 0x7;
        const imm = instr & 0x3F;
        this.setReg(rd, this.regs[rs1] | imm);
        break;
      }

      case Op.XORI: {
        const rd  = (instr >> 9) & 0x7;
        const rs1 = (instr >> 6) & 0x7;
        const imm = instr & 0x3F;
        this.setReg(rd, this.regs[rs1] ^ imm);
        break;
      }

      case Op.SLLI: {
        const rd  = (instr >> 9) & 0x7;
        const rs1 = (instr >> 6) & 0x7;
        const shamt = instr & 0xF; // low 4 bits
        this.setReg(rd, this.regs[rs1] << shamt);
        break;
      }

      case Op.SRLI: {
        const rd  = (instr >> 9) & 0x7;
        const rs1 = (instr >> 6) & 0x7;
        const shamt = instr & 0xF;
        this.setReg(rd, this.regs[rs1] >>> shamt);
        break;
      }

      case Op.SRAI: {
        const rd  = (instr >> 9) & 0x7;
        const rs1 = (instr >> 6) & 0x7;
        const shamt = instr & 0xF;
        this.setReg(rd, i16(this.regs[rs1]) >> shamt);
        break;
      }

      case Op.LW: {
        const rd   = (instr >> 9) & 0x7;
        const base = (instr >> 6) & 0x7;
        const off  = sext(instr & 0x3F, 6);
        const addr = (this.regs[base] + off) & 0xFFFF;
        if (addr & 1) {
          this.trap(Cause.MISALIGNED_ACCESS);
          return { pc, instr, running: true };
        }
        this.setReg(rd, this.read16(addr));
        break;
      }

      case Op.SW: {
        const rs   = (instr >> 9) & 0x7;
        const base = (instr >> 6) & 0x7;
        const off  = sext(instr & 0x3F, 6);
        const addr = (this.regs[base] + off) & 0xFFFF;
        if (addr & 1) {
          this.trap(Cause.MISALIGNED_ACCESS);
          return { pc, instr, running: true };
        }
        this.write16(addr, this.regs[rs]);
        break;
      }

      case Op.LB: {
        const rd   = (instr >> 9) & 0x7;
        const base = (instr >> 6) & 0x7;
        const off  = sext(instr & 0x3F, 6);
        const addr = (this.regs[base] + off) & 0xFFFF;
        this.setReg(rd, sext(this.read8(addr), 8));
        break;
      }

      case Op.SB: {
        const rs   = (instr >> 9) & 0x7;
        const base = (instr >> 6) & 0x7;
        const off  = sext(instr & 0x3F, 6);
        const addr = (this.regs[base] + off) & 0xFFFF;
        this.write8(addr, this.regs[rs]);
        break;
      }

      case Op.JAL: {
        const imm12 = sext(instr & 0xFFF, 12);
        this.setReg(7, nextPc);
        nextPc = (nextPc + (imm12 << 1)) & 0xFFFF;
        break;
      }

      case Op.SYS: {
        const sub = (instr >> 9) & 0x7;
        const reg = (instr >> 6) & 0x7;
        const csr = instr & 0x3F;

        switch (sub) {
          case Sys.ECALL:
            if (reg !== 0 || csr !== 0) { this.trap(Cause.ILLEGAL_INSTRUCTION); return { pc, instr, running: true }; }
            if (this.inSupervisorMode) {
              this.trap(Cause.ECALL_SUPERVISOR);
            } else {
              this.trap(Cause.ECALL_USER);
            }
            this.onEcall(this);
            return { pc, instr, running: !this.halted };

          case Sys.EBREAK:
            if (reg !== 0 || csr !== 0) { this.trap(Cause.ILLEGAL_INSTRUCTION); return { pc, instr, running: true }; }
            this.trap(Cause.BREAKPOINT);
            this.onEbreak?.();
            return { pc, instr, running: !this.halted };

          case Sys.ERET:
            if (reg !== 0 || csr !== 0) { this.trap(Cause.ILLEGAL_INSTRUCTION); return { pc, instr, running: true }; }
            if (!this.inSupervisorMode) { this.trap(Cause.ILLEGAL_INSTRUCTION); return { pc, instr, running: true }; }
            nextPc = this.csrs[Csr.EPC];
            this.csrs[Csr.STATUS] = this.csrs[Csr.ESTATUS];
            break;

          case Sys.FENCE:
            if (reg !== 0 || csr !== 0) { this.trap(Cause.ILLEGAL_INSTRUCTION); return { pc, instr, running: true }; }
            // no-op on single-core
            break;

          case Sys.CSRR:
            if (!this.inSupervisorMode) { this.trap(Cause.ILLEGAL_INSTRUCTION); return { pc, instr, running: true }; }
            this.setReg(reg, this.csrs[csr]);
            break;

          case Sys.CSRW:
            if (!this.inSupervisorMode) { this.trap(Cause.ILLEGAL_INSTRUCTION); return { pc, instr, running: true }; }
            this.csrs[csr] = this.regs[reg];
            break;

          default:
            this.trap(Cause.ILLEGAL_INSTRUCTION);
            return { pc, instr, running: true };
        }
        break;
      }

      case Op.BEQ: {
        const rs1 = (instr >> 9) & 0x7;
        const rs2 = (instr >> 6) & 0x7;
        const off = sext(instr & 0x3F, 6);
        if (this.regs[rs1] === this.regs[rs2]) {
          nextPc = (nextPc + (off << 1)) & 0xFFFF;
        }
        break;
      }

      case Op.BNE: {
        const rs1 = (instr >> 9) & 0x7;
        const rs2 = (instr >> 6) & 0x7;
        const off = sext(instr & 0x3F, 6);
        if (this.regs[rs1] !== this.regs[rs2]) {
          nextPc = (nextPc + (off << 1)) & 0xFFFF;
        }
        break;
      }
    }

    this.pc = nextPc;
    return { pc, instr, running: !this.halted };
  }

  /** Run until halted or max cycles reached. */
  run(maxCycles = 1_000_000): number {
    const startCycles = this.cycles;
    while (this.cycles - startCycles < maxCycles) {
      const result = this.step();
      if (!result.running) {
        break;
      }
    }
    return this.cycles - startCycles;
  }

  /** Reset all state. */
  reset(): void {
    this.regs.fill(0);
    this.mem.fill(0);
    this.csrs.fill(0);
    this.pc = 0;
    this.halted = false;
    this.cycles = 0;
    this.csrs[Csr.STATUS] = STATUS_PRIV;
  }

  /** Dump register state for debugging. */
  dump(): string {
    const lines: string[] = [];
    for (let i = 0; i < NUM_REGS; i++) {
      lines.push(`r${i} = 0x${this.regs[i].toString(16).padStart(4, "0")}`);
    }
    lines.push(`pc = 0x${this.pc.toString(16).padStart(4, "0")}`);
    return lines.join("\n");
  }
}
