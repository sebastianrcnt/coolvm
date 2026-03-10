#!/usr/bin/env bun
// cool8 CLI — assemble and run cool8 programs

import { Cool8 } from "./core";
import { assemble } from "./assembler";
import { disassemble } from "./disassembler";

const USAGE = `usage: cool8 <command> [options] <file>

commands:
  run <file.asm>        assemble and execute a program
  asm <file.asm>        assemble and print hex output
  dis <file.bin>        disassemble a binary file

options:
  --trace               print each instruction as it executes
  --max-cycles <n>      execution limit (default: 1000000)
`;

async function main() {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.length === 0) {
    console.log(USAGE);
    process.exit(1);
  }

  const positional: string[] = [];
  const flags = new Set<string>();
  let maxCycles = 1_000_000;

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === "--trace") {
      flags.add(arg);
      continue;
    }

    if (arg === "--max-cycles") {
      const next = rawArgs[i + 1];
      if (!next || next.startsWith("--")) {
        console.error("error: --max-cycles requires a numeric argument");
        process.exit(1);
      }
      const parsed = parseInt(next, 10);
      if (Number.isNaN(parsed) || parsed <= 0) {
        console.error("error: --max-cycles requires a positive integer");
        process.exit(1);
      }
      maxCycles = parsed;
      i += 1;
      continue;
    }

    if (arg.startsWith("--")) {
      console.error(`error: unknown option: ${arg}`);
      process.exit(1);
    }

    positional.push(arg);
  }

  if (positional.length === 0) {
    console.log(USAGE);
    process.exit(1);
  }

  const command = positional[0];
  const files = positional.slice(1);

  const trace = flags.has("--trace");

  switch (command) {
    case "run": {
      if (files.length < 1) {
        console.error("error: run requires an assembly file");
        process.exit(1);
      }
      const source = await Bun.file(files[0]).text();
      const result = assemble(source);
      if (result.errors.length > 0) {
        for (const error of result.errors) {
          console.error(`line ${error.line}: ${error.message}`);
        }
        process.exit(1);
      }

      const vm = new Cool8();
      vm.onMmioWrite = (_, value) => {
        process.stdout.write(String.fromCharCode(value & 0xff));
      };

      vm.onSys = () => {
        vm.halted = true;
      };

      vm.load(result.program);

      if (trace) {
        const startCycles = vm.cycles;
        while (vm.cycles - startCycles < maxCycles) {
          const step = vm.step();
          console.log(
            `[${step.pc.toString(16).padStart(2, "0")}] ${step.instr.toString(16).padStart(2, "0")}  ${disassemble(step.instr, step.pc)}`,
          );
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
      if (files.length < 1) {
        console.error("error: asm requires an assembly file");
        process.exit(1);
      }

      const source = await Bun.file(files[0]).text();
      const result = assemble(source);
      if (result.errors.length > 0) {
        for (const error of result.errors) {
          console.error(`line ${error.line}: ${error.message}`);
        }
        process.exit(1);
      }

      for (let i = 0; i < result.program.length; i++) {
        console.log(
          `${i.toString(16).padStart(2, "0")}: ${result.program[i].toString(16).padStart(2, "0")}`,
        );
      }
      break;
    }

    case "dis": {
      if (files.length < 1) {
        console.error("error: dis requires a binary file");
        process.exit(1);
      }

      const bytes = new Uint8Array(await Bun.file(files[0]).arrayBuffer());
      for (let i = 0; i < bytes.length; i++) {
        const instr = bytes[i] ?? 0;
        console.log(
          `${i.toString(16).padStart(2, "0")}: ${instr.toString(16).padStart(2, "0")}  ${disassemble(instr, i)}`,
        );
      }
      break;
    }

    default:
      console.error(`unknown command: ${command}`);
      console.log(USAGE);
      process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
