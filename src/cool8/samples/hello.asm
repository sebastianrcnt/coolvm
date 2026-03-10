# hello.asm — print "ABC\n" via MMIO byte write
#
# `ST <addr>, <value>` stores one byte. MMIO addresses >= 0xF0 are
# forwarded to the CLI output callback in this implementation.

# Build output address 0xF0 into r3.
LDI r3, 3
ADDI r3, 1
SHL r3, 3
ADDI r3, -2
SHL r3, 3

# Build ASCII 'A' (65) into r1.
LDI r1, 3
ADDI r1, 2
SHL r1, 2
SHL r1, 2
ADDI r1, 1
LDI r2, 3
SHL r2, 2
SHL r2, 2
ADD r1, r2

# 3-iteration loop:
# - print current char
# - decrement counter
# - loop while counter != 0
LDI r2, 3
output_loop:
  ST r3, r1
  ADDI r1, 1
  ADDI r2, -1
  BNE output_loop

# Build '\n' (10) and output.
LDI r1, 3
SHL r1, 2
ADDI r1, -2
ST r3, r1

SYS
