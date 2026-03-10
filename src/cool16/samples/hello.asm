# hello.asm — print "Hello, World!\n" via ECALL putchar
#
# ECALL syscall convention:
#   r1 = 0  putchar(r2)  — write byte r2[7:0] to stdout
#   r1 = 1  exit(r2)     — terminate with exit code r2
#
# Uses .ascii to embed the string in memory and a loop to print it.

.equ PUTCHAR, 0
.equ EXIT,    1

        LI   r6, 0xFE00    # stack pointer → top of user space
        JAL  start
msg:
        .ascii "Hello, World!\n\0"
start:
        LI   r3, msg       # r3 = pointer to string
.loop:
        LB   r4, 0(r3)
        BEQ  r4, r0, .done
        MOV  r2, r4
        ADDI r1, r0, PUTCHAR
        ECALL
        ADDI r3, r3, 1
        BEQ  r0, r0, .loop
.done:
        ADDI r1, r0, EXIT
        ADDI r2, r0, 0
        ECALL
