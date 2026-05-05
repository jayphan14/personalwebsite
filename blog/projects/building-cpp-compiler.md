I built [cpp-compiler](https://github.com/jayphan14/cpp-compiler) as my way of finally seeing a compiler end to end instead of in fragments. It is a small C++ compiler for **WLP4**, a simplified C++ teaching language from UWaterloo's CS241, and it emits **MIPS** assembly that runs on the course simulator.

It is small on purpose. WLP4 has `int`, `int*`, `if`/`else`, `while`, `return`, `new`/`delete`, pointer arithmetic, and a single `wain` entry point. No structs, no templates, no overloading, no preprocessor, no header files. That smallness is the whole point. The real C++ compiler I will never build is millions of lines, and most of that mass lives in features WLP4 deliberately does not have.

What I wanted out of this project was the spine: source text in, machine code out, every stage in between something I could read.

## The pipeline

The compiler is four stages, run as a sequence of stdin/stdout filters. The output of each stage is plain text. There is no shared in-memory IR object passed between them. The contract is the bytes on the pipe.

![WLP4 to MIPS pipeline: Source → Tokens → Parse tree → Typed tree → Assembly → MIPS, with stages scanner, parser, typecheck, codegen, cs241 linker](assets/graphs/compiler-pipeline.svg)

```
.wlp4  →  scanner  →  parser  →  typecheck  →  codegen  →  .asm  →  cs241 linker  →  .mips
```

1. **Scanner** turns characters into a token stream.
2. **Parser** turns the token stream into a parse tree.
3. **Typecheck** decorates that tree with types and rejects programs the type system says are wrong.
4. **Codegen** walks the typed tree and emits MIPS assembly.

After codegen, the CS241 linker stitches the output together with two runtime modules (`print.merl` for `println`, `alloc.merl` for `new`/`delete`) and produces a MIPS binary that the `mips.twoints` simulator runs.

The stdin/stdout discipline is the thing I would do again on any future compiler. Every stage is its own binary in `build/`. I can run scanner alone on a snippet and stare at its tokens. I can hand-write a parse tree, pipe it into typecheck, and check what passes. When something is wrong, I bisect by stage. The pipe is the debugger.

## Walking each stage

**Scanner.** A DFA-style state machine over characters. Recognises keywords, identifiers, integer literals, the punctuation, and comments. WLP4 keeps this part friendly: no string literals, no floats, no preprocessor. The one wart is that integer literals must fit in a signed 32-bit range, so the scanner has to reject `2147483648` even though `-2147483648` is legal (because the `-` is a separate token). Edge cases like that are why a tokenizer is more than `split`.

**Parser.** Bottom-up, driven by a precomputed LR(1) table for the WLP4 grammar. The grammar is given; the parser is a generic shift-reduce engine that consumes it. Each reduction emits a node of the parse tree on stdout in the course's textual format: one line per node, indented by depth, holding the production rule that fired. WLP4 is unambiguous and small, so this works cleanly. Real C++ would not — its grammar is not context-free, and `T * x;` is the famous example. WLP4 sidesteps that entire class of problem by not having user-defined types at all.

**Typecheck.** This is where the program goes from "syntactically legal" to "actually means something." The pass walks the parse tree, builds a symbol table per function, and gives every expression a type. Every binary operator has rules: `int + int → int`, `int* + int → int*`, `int* - int* → int`, and so on. Pointer arithmetic is the part that takes the most care. `*p` requires `p : int*`. `&x` produces `int*`. `NULL` is `int*`. `new int[n]` is `int*` and demands `n : int`. The pass also enforces the two valid signatures of `wain`: `(int, int)` or `(int*, int)`. Anything else is an error.

What surprised me here is how much of "type checking" is really name resolution dressed up. Most type errors I caught in practice were "you wrote `x` and there is no `x` in scope" or "you called `foo` with the wrong number of arguments." The actual algebra of types is small. The bookkeeping around scopes and declarations is most of the code.

**Codegen.** Walks the typed tree and emits MIPS, one statement at a time, using the calling convention the course defines. Rough shape:

- The frame pointer (`$29`) points at the current activation record. Locals live at fixed offsets.
- `$30` is the stack pointer; pushes and pops are explicit `sw`/`lw` plus arithmetic on `$30`.
- Every expression evaluates into `$3`. Binary operations push the left operand, evaluate the right into `$3`, pop the left into `$5`, then operate. Naive and uniform.
- `if`/`while` emit unique labels and conditional branches. Pointer arithmetic generates the multiply-by-four when one side is `int*`.
- `new int[n]` calls into `alloc.merl`. `println` calls into `print.merl`.

There is no register allocation worth the name. `$3` and `$5` carry every intermediate, and the stack soaks up the rest. The code is slow. It is also obviously correct, which matters more for a teaching compiler than for a fast one. A register allocator and a peephole pass are the natural next thing to add, and the natural place where this project would stop being small.

## How I built each stage

Bottom of the pipeline first, like the database engine before this. The order I built things in, which is also the order I would recommend:

1. **Scanner.** Write the DFA. Read the WLP4 lexical spec line by line. Test it on every example file in `examples/` until the token stream looks right by eye. Do not move on until invalid programs reject with sensible errors.
2. **Parser.** Take the LR(1) table as a given. Write the generic shift-reduce engine. Print the parse tree in the course's expected format. Run the parser on the same examples and diff against known-good outputs. Most of the early bugs were in the printer, not the engine.
3. **Typecheck.** Hardest stage to get right. Build the symbol table first (functions, then per-function locals). Then walk expressions bottom up and assign types. Then enforce statement rules: `if`/`while` conditions are comparisons, `return` matches function return type, `wain` has a legal signature. I added pre-typed test inputs in `tests/` so I could iterate on codegen later without re-running typecheck on each change.
4. **Codegen.** I started with a program that returned a constant from `wain` and grew the cases outward. Add `int`-only expressions. Then locals and assignment. Then `if`/`while`. Then function calls with the prologue and epilogue. Then pointers and the runtime. Each new feature was a new tree case and a new fixture. Run it through the simulator. If the answer is wrong, the bug is almost certainly in the calling convention or in evaluation order. It almost never was the simulator.

The thing that paid off most was the textual contract between stages. Every time I doubted myself, I could look at the actual bytes leaving one stage and entering the next. No "what is the parser doing" mysteries. The artefact is right there on the pipe.

## What I would not have appreciated without building this

Three things, none of them in any compiler textbook chapter I had read.

**An IR is a luxury, not a requirement.** Real compilers have one because they want to share optimisations across languages and targets. WLP4 has one source language, one target, and no optimisations beyond what falls out of being naive. Skipping the IR and lowering the typed tree directly to MIPS removed an entire stage and an entire class of bugs. I would only add an IR when there is a second target or a real optimiser to justify it.

**Calling conventions are most of codegen.** Once the prologue, epilogue, argument passing, and frame layout are nailed down, the rest of code generation is mostly mechanical. Functions were the longest debugging session of the project. Locals at the wrong offset, the frame pointer set up before the arguments instead of after, return value stomped by the epilogue. After that fight, every other feature was "emit the obvious thing."

**The type checker is where the language actually lives.** The grammar describes shape. The type checker describes meaning. Pointer arithmetic, `wain`'s signature, what `NULL` is allowed to do — none of it is in the parser. All of it is in the rules the type checker enforces. If you want to really understand a language, read its semantic analyser, not its grammar.

## What I take away

I will never build a real C++ compiler. After this project, I am even more sure of that. C++'s complexity does not live in the pipeline shape, it lives in templates, in overload resolution, in two-phase name lookup, in the preprocessor, in the standard's 1900 pages of edge cases. WLP4's pipeline is the same shape as a real compiler's pipeline. The size difference is almost entirely in the typecheck and codegen stages.

But the shape itself is now in my head, and that is what I came here for. Every time I see a confusing C++ error, a surprising piece of generated assembly, or a debate about whether something is a parser problem or a semantic one, I have a map. Source, tokens, tree, typed tree, assembly. Each stage is its own discipline. Each error has a home.

If you have programmed in a compiled language for years and never built one, build a tiny one. Pick a small language with a given grammar, WLP4, a Lisp, a calculator with variables and write the four stages. You will understand your day job differently afterwards.
