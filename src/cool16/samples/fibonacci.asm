# fibonacci.asm — compute fib(N) iteratively and exit with that value
#
# Input:  .equ N sets the desired index (0-indexed)
# Output: program exits with code fib(N) (exit argument r2)
#
# Examples: fib(0)=0, fib(1)=1, fib(2)=1, fib(10)=55

.equ N, 10
.equ EXIT, 1

        ADDI r2, r0, N
        JAL  fib

        # syscall 1 = exit(r2)
        MOV  r2, r1
        ADDI r1, r0, EXIT
        ECALL

# fib(N)
#   arg: r2 = N
#   ret: r1 = fib(N)
# clobbers: r3, r4, r5
fib:
        BEQ  r2, r0, .base0       # if N == 0 -> 0

        ADDI r3, r0, 0            # a = 0
        ADDI r4, r0, 1            # b = 1
        ADDI r5, r0, 1            # i = 1

.loop:
        BEQ  r5, r2, .done        # when i == N, b is fib(N)
        ADD  r1, r3, r4           # t = a + b
        MOV  r3, r4               # a = b
        MOV  r4, r1               # b = t
        ADDI r5, r5, 1            # i++
        BEQ  r0, r0, .loop

.done:
        MOV  r1, r4
        RET

.base0:
        MOV  r1, r0
        RET
