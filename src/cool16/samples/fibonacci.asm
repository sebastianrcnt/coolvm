; fibonacci.asm — compute the Nth Fibonacci number
;
; Input:  r2 = N (which Fibonacci number to compute, 0-indexed)
; Output: r1 = fib(N)
;
; fib(0)=0, fib(1)=1, fib(2)=1, fib(3)=2, ..., fib(10)=55
;
; ECALL convention:
;   r1 = syscall number  (1 = exit with value in r2)
;   r2 = argument
;
; Usage: set r2 before jumping to fib, result in r1 after RET.
; This file runs standalone with N=10.

.equ N, 10

        ; --- entry: compute fib(N) ---
        ADDI r2, r0, N
        JAL  fib
        ; result is in r1

        ; syscall 1 = exit(r1)
        MOV  r2, r1
        ADDI r1, r0, 1
        ECALL

; -------------------------------------------------------------------
; fib(N) — iterative Fibonacci
;
; Arguments:  r2 = N
; Returns:    r1 = fib(N)
; Clobbers:   r3, r4, r5
; Preserves:  r6 (sp), r7 (lr)
; -------------------------------------------------------------------
fib:
        ; handle base cases: fib(0)=0, fib(1)=1
        BEQ  r2, r0, .base0         ; if N == 0, return 0
        ADDI r3, r0, 1
        BEQ  r2, r3, .base1         ; if N == 1, return 1

        ; iterative loop:  a=0, b=1, i=2
        ADDI r3, r0, 0              ; r3 = a (fib(i-2))
        ADDI r4, r0, 1              ; r4 = b (fib(i-1))
        ADDI r5, r0, 1              ; r5 = i

.loop:
        BEQ  r5, r2, .done          ; if i == N, done
        ADD  r1, r3, r4             ; r1 = a + b
        MOV  r3, r4                 ; a = b
        MOV  r4, r1                 ; b = a+b
        ADDI r5, r5, 1              ; i++
        BEQ  r0, r0, .loop

.done:
        MOV  r1, r4                 ; return b
        JALR r0, r7

.base0:
        MOV  r1, r0                 ; return 0
        JALR r0, r7

.base1:
        ADDI r1, r0, 1              ; return 1
        JALR r0, r7
