# sum_to_n.asm — compute 1..3, convert to ASCII digit, print, newline
#
# r1 accumulates sum.
# r2 is loop counter.

# Build MMIO output address (0xF0) into r3.
LDI r3, 3
ADDI r3, 1
SHL r3, 3
ADDI r3, -2
SHL r3, 3

# r1 <- 0
LDI r1, 0

# r2 <- 3
LDI r2, 3

sum_loop:
  ADD r1, r2
  ADDI r2, -1
  BNE sum_loop

# Convert ASCII '0' (0x30) and print.
LDI r2, 3
SHL r2, 2
SHL r2, 2
ADD r1, r2
ST r3, r1

# Print '\n' (0x0A).
LDI r2, 3
SHL r2, 2
ADDI r2, -2
ST r3, r2
SYS
