# branch.asm — BEZ/BNZ conditionals with short offsets

# Build output address (0xF0) into r3.
LDI r3, 3
ADDI r3, 1
SHL r3, 3
ADDI r3, -2
SHL r3, 3

# Build ASCII '0' (0x30) into r2.
LDI r2, 3
SHL r2, 2
SHL r2, 2

# r1 <- 0
SUB r1, r1
BEZ beq_zero

# r1 != 0 path: print '1'
ADDI r2, 1

beq_zero:
ST r3, r2

# r2 <- '2'
LDI r2, 3
SHL r2, 2
SHL r2, 2
ADDI r2, 1
ADDI r2, 1

# r1 <- 1
LDI r1, 3
ADDI r1, 2

# r1 != 0 path: print '2'
BNZ bnz_nonzero
ADDI r2, 1

bnz_nonzero:
ST r3, r2

SYS
