Of the three C++ performance talks I've worked through this summer, this is the one I regret not watching first. Not because it's the deepest. It isn't. It's because it's the broadest. Jan Bielak's *The Most Important Optimizations to Apply in Your C++ Programs* (CppCon 2022) is essentially a checklist of every optimization technique a working C++ programmer should know about, on the surface. If you want one talk that covers the field, this is the one. My notes on the other two are here: [Carl Cook (CppCon 2017)](article.html?slug=microsecond-eternity) and [David Gross (CppCon 2024)](article.html?slug=when-nanoseconds-matter).

The other thing that gets me about this talk: Jan was in high school when he gave it. Not finishing-up-undergrad, not first-year. High school. I had to double-check because I didn't believe it. The poise, the pacing, and the sheer breadth of material is the kind of thing you'd expect from someone with a decade in the industry. Crazy.

## What kind of talk this is

Cook and Gross are both at Optiver and both lean into low-latency trading specifics. Bielak's talk is different. It's general-purpose performance C++. Game engines, physics, graphics, scientific computing, and yes also low-latency, all sit under the same umbrella. The framing isn't "how do we send orders in five microseconds." It's "if you write performance-sensitive C++ for any reason, here are the things you need to know about."

The format is roughly a tour. Each technique gets a slide or two, a small code example, and a sentence on when it matters. There are no deep dives. The talk is a map of the territory, not a guided expedition through any one part of it. That's exactly what makes it useful as a starting point.

## What it covers

Grouped roughly the way I'd group it after re-watching:

### Compiler-side wins (cheap, high impact)

- **`const`, `constexpr`, `consteval`, `constinit`.** Push computation to compile time. The compiler can fold constants, eliminate dead branches, and inline through compile-time-known values in ways it can't through runtime values.
- **Compiler flags.** `-O2` or `-O3`, `-march=native`, `-flto`. None of these require code changes. All of them produce real wins. The talk is matter-of-fact about checking the flags before reaching for code-level optimizations, which is the right order.
- **PGO (profile-guided optimization).** Build, profile a representative run, rebuild with the profile. The compiler now knows which branches are hot, which functions to inline aggressively, and which paths to lay out for the I-cache.
- **LTO (link-time optimization).** Lets the compiler optimize across translation unit boundaries. Inline calls into other `.cpp` files, propagate constants, devirtualize when types are known program-wide.

The order of operations matters here. Bielak's argument, as I read it, is to do all of this before touching your code, because it's free and often big.

### Memory and data layout

This is the section that maps most clearly onto the diagram I've used:

- **Cache lines.** A cache line is 64 bytes on most hardware. Every memory access pulls a whole line. Lay out your hot data so reads use the line fully.
- **AoS vs SoA.** If your hot loop reads one field of a struct, an array of structs wastes most of the cache line on bycatch. A struct of arrays packs the field densely, makes the prefetcher's job trivial, and vectorises naturally.

![Array of Structs versus Struct of Arrays: AoS pulls a cache line where most fields are unused, SoA pulls a cache line where every byte is the field you wanted](assets/graphs/aos-vs-soa.svg)

- **Avoid heap allocation in hot paths.** `new` and `malloc` are slow, fragment memory, and can cause TLB misses. Pre-allocate. Reserve vectors. Use object pools.
- **Alignment.** `alignas` to align hot structures to cache lines. Pad to avoid false sharing between threads writing to adjacent fields.
- **Custom allocators.** Arena allocators for short-lived objects. Pool allocators for fixed-size objects. The standard library's allocator is general-purpose, which means it's a worst-case for any specific workload.

### Branches and control flow

- **`[[likely]]` / `[[unlikely]]`.** C++20 attributes that hint the compiler about branch direction. Used right, they pull cold paths out of the I-cache and keep the hot path linear.
- **Avoid unpredictable branches.** Branches that depend on data the predictor can't model (random keys, market data, hash bucket lookups) are expensive. Sometimes a branchless rewrite (`cmov`, lookup tables, bitmask tricks) is faster than the conditional.
- **Switch vs dispatch tables.** A dense `switch` on a small integer compiles to a jump table. A sparse `switch` becomes a chain of compares. If you control the values, make them dense.

### Function calls and dispatch

- **Inlining.** `inline` is a hint, but `[[gnu::always_inline]]` forces it where you really need it. Worth using on small hot functions where call overhead would dominate.
- **Avoid virtual where the type is known.** Templates, CRTP, `if constexpr`, and tag dispatch let you keep abstraction without paying for vtables. The same point Cook makes in 2017 and Gross repeats in 2024.
- **Pass by value for small types.** Passing a 4-byte `int` by `const&` forces a memory indirection that passing by value avoids. The threshold is roughly "fits in a register or two."

### Vectorisation

- **Auto-vectorisation.** The compiler will vectorise loops if it can prove the access pattern is safe. SoA layouts and contiguous reads make its job easy.
- **`__restrict__`.** Tells the compiler two pointers don't alias, unlocking vectorisation that the strict aliasing rules wouldn't otherwise permit.
- **Strict aliasing.** Casting between unrelated pointer types is undefined behaviour and stops the compiler from reordering or vectorising. Use `std::memcpy` or `std::bit_cast` for type punning.
- **Manual SIMD.** Intrinsics when the compiler can't auto-vectorise. The talk introduces the idea but, characteristically, doesn't go deep.

### Move semantics and copies

- **Move-construct and move-assign in containers.** A `std::vector<std::string>` resize is much faster when the strings move. Mark moves `noexcept` or `vector` will copy on resize.
- **RVO and NRVO.** Returning local objects by value is free in modern compilers. Don't pessimise it by writing `std::move(x)` on the return.

## What stuck with me

A few of these I'd seen before in scattered places. What the talk did was put them in one frame, in roughly the right order of importance. If I were going to give one piece of advice to my own past self about reading this talk, it would be: *do the compiler-side and layout fixes before you touch the code.* In that order:

1. Check your compiler flags. Add `-O3`, `-march=native`, `-flto`. Try PGO if your workload is stable.
2. Look at your data layout. Hot loops reading one field of a wide struct? Switch to SoA.
3. Look at your allocations. Hot path allocating? Pre-allocate or pool.
4. Look at your branches. Predictable? Fine. Unpredictable? Consider branchless.
5. Then profile and look at specific functions.

Most performance work I'd seen in the wild starts at step 5 and ignores 1 through 4. That's backwards.

## How this fits with Cook and Gross

Cook is the principles for low-latency systems specifically. Gross is the deep dive on one data structure with modern hardware and modern profiling. Bielak is the breadth.

The three together are kind of a complete curriculum:

- **Bielak (CppCon 2022)** for the menu of techniques. What's even out there.
- **Cook (CppCon 2017)** for the principles of low-latency systems. Hot path discipline, slow path removal, the always-running pattern.
- **Gross (CppCon 2024)** for the deep dive. What it actually looks like to apply these ideas to one piece of code with measurements at every step.

If I were re-doing my preparation for the Citsec internship, I'd watch them in that order. Bielak first to get the lay of the land. Cook second to understand why low-latency is its own discipline. Gross third to see the ideas in action.

## On Jan being in high school

I keep coming back to this and it's worth restating. There are senior engineers who couldn't deliver a talk this clear. The technical content is correct. The pacing is good. The slides are designed. The examples are well chosen. And he was a teenager.

It's the kind of thing that makes you recalibrate what "young" means in this field. If you're a CS undergrad and feeling like you started late, watch this talk. It's a useful kick.
