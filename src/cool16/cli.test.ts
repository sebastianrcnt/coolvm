import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const cliPath = new URL("./cli.ts", import.meta.url).pathname;
const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "cool16-cli-"));
  tempDirs.push(dir);
  return dir;
}

describe("cli", () => {
  test("trace mode prints decoded instructions", () => {
    const dir = makeTempDir();
    const asmPath = join(dir, "trace.asm");
    writeFileSync(asmPath, "ADDI r1, r0, 5\nECALL\n");

    const result = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "run", "--trace", asmPath],
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    const stdout = new TextDecoder().decode(result.stdout);
    expect(stdout).toContain("[0000] 1205  ADDI r1, r0, 5");
    expect(stdout).toContain("[0002] b000  ECALL");
    expect(stdout).toContain("--- halted after 2 cycles ---");
  });

  test("dis command decodes a binary file", () => {
    const dir = makeTempDir();
    const binPath = join(dir, "prog.bin");
    writeFileSync(binPath, new Uint8Array([0x05, 0x12, 0x00, 0xb0]));

    const result = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "dis", binPath],
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    const stdout = new TextDecoder().decode(result.stdout);
    expect(stdout).toContain("0000: 1205  ADDI r1, r0, 5");
    expect(stdout).toContain("0002: b000  ECALL");
  });
});
