# countdigits.asm — print "0123\n" via MMIO byte write
#
# Uses only cool8 ISA:
# - I-type immediates are 2-bit (LDI/ADDI)
# - ST writes one byte to the MMIO window (>= 0xF0 is printed by CLI)

# Build MMIO output address (0xF0) into r3.
LDI r3, 3
ADDI r3, 1
SHL r3, 3
ADDI r3, -2
SHL r3, 3

# Build ASCII '0' (0x30).
LDI r2, 3
SHL r2, 2
SHL r2, 2

# Print "0", "1", "2", "3"
ST r3, r2
ADDI r2, 1
ST r3, r2
ADDI r2, 1
ST r3, r2
ADDI r2, 1
ST r3, r2

# Print '\n' (0x0A).
LDI r2, 3
SHL r2, 2
ADDI r2, -2
ST r3, r2
SYS
