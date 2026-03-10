# hello2.asm — print "Hello, World!\n" via .ascii + MMIO

# Build MMIO output address (0xF0) into r3.
LDI r3, 3
ADDI r3, 1
SHL r3, 3
ADDI r3, -2
SHL r3, 3

# Message starts at logical address 0x0e (14).
LDI r2, 2
SHL r2, 3
ADDI r2, -2

loop:
    LD   r1, r2
    BEZ  done            # r1 == 0이면 종료
    ST   r3, r1
    ADDI r2, 1
    BNZ  loop

done:
    SYS

.ascii 'Hello, world!\n'
.byte 0
