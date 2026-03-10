#!/usr/bin/env bun
// cool16 CLI — assemble and run cool16 programs

import { Cool16 } from "./core";
import { assemble } from "./assembler";
import { disassemble } from "./disassembler";

const USAGE = `usage: cool16 <command> [options] <file>

commands:
  run <file.asm>        Assemble and execute a program
  asm <file.asm>        Assemble and print hex output
  dis <file.bin>        Disassemble a binary file

options:
  --trace               Print each instruction as it executes
  --max-cycles <n>      Limit execution cycles (default: 1000000)
`;

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log(USAGE);
    process.exit(1);
  }

  const command = args[0];
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const positional = args.slice(1).filter((a) => !a.startsWith("--"));
  const trace = flags.has("--trace");
  const maxCyclesFlag = args.find((_, i) => args[i - 1] === "--max-cycles");
  const maxCycles = maxCyclesFlag ? parseInt(maxCyclesFlag) : 1_000_000;

  switch (command) {
    case "run": {
      if (positional.length < 1) {
        console.error("error: run requires an assembly file");
        process.exit(1);
      }
      const source = await Bun.file(positional[0]).text();
      const result = assemble(source);

      if (result.errors.length > 0) {
        for (const e of result.errors) {
          console.error(`line ${e.line}: ${e.message}`);
        }
        process.exit(1);
      }

      const vm = new Cool16();
      vm.load(result.program);
      vm.onEcall = (v) => { v.halted = true; };

      if (trace) {
        const startCycles = vm.cycles;
        while (vm.cycles - startCycles < maxCycles) {
          const step = vm.step();
          console.log(`[${step.pc.toString(16).padStart(4, "0")}] ${step.instr.toString(16).padStart(4, "0")}  ${disassemble(step.instr, step.pc)}`);
          if (!step.running) {
            break;
          }
        }
        console.log(`\n--- halted after ${vm.cycles - startCycles} cycles ---`);
      } else {
        const cycles = vm.run(maxCycles);
        console.log(`halted after ${cycles} cycles`);
      }

      console.log(vm.dump());
      break;
    }

    case "asm": {
      if (positional.length < 1) {
        console.error("error: asm requires an assembly file");
        process.exit(1);
      }
      const source = await Bun.file(positional[0]).text();
      const result = assemble(source);

      if (result.errors.length > 0) {
        for (const e of result.errors) {
          console.error(`line ${e.line}: ${e.message}`);
        }
        process.exit(1);
      }

      for (let i = 0; i < result.program.length; i++) {
        const addr = (i * 2).toString(16).padStart(4, "0");
        const word = result.program[i].toString(16).padStart(4, "0");
        console.log(`${addr}: ${word}`);
      }
      break;
    }

    case "dis": {
      if (positional.length < 1) {
        console.error("error: dis requires a binary file");
        process.exit(1);
      }
      const bytes = new Uint8Array(await Bun.file(positional[0]).arrayBuffer());
      for (let i = 0; i < bytes.length; i += 2) {
        const addr = i & 0xFFFF;
        const lo = bytes[i] ?? 0;
        const hi = bytes[i + 1] ?? 0;
        const word = lo | (hi << 8);
        console.log(`${addr.toString(16).padStart(4, "0")}: ${word.toString(16).padStart(4, "0")}  ${disassemble(word, addr)}`);
      }
      break;
    }

    default:
      console.error(`unknown command: ${command}`);
      console.log(USAGE);
      process.exit(1);
  }
}

main();
