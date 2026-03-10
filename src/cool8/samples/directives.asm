# directives.asm — .equ / .byte / .ascii usage example

# .equ defines constant values used by later directives and instructions.
.equ NEWLINE, 10
.equ SPACE, 32
.equ ZERO, 0

# Program body: terminate immediately to show directives are data-only in this sample.
LDI r1, 0
SYS

# Directive data (placed after SYS, not executed as instructions).
.byte NEWLINE, SPACE
.ascii "directive ok\n"
