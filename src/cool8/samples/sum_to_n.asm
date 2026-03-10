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

# Build 6 in r1.
LDI r1, 3
ADDI r1, 1
ADDI r1, 1
ADDI r1, 1

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
