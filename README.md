# coolvm

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run src/index.ts
```

This project was created using `bun init` in bun v1.3.10. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

## cool16 highlights

- 16-bit educational RISC ISA + assembler/disassembler/VM
- Trap/CSR model with supervisor/user privilege
- MMIO UART at `0xFF00` with cycle-driven TX timing and external interrupt support

See `src/cool16/README.md` and `src/specs/cool16.md` for full architecture details.
