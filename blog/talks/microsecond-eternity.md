Right after I watched David Gross's *When Nanoseconds Matter*, I went back and watched the talk that everyone in low-latency C++ points to as its predecessor: Carl Cook's *When a Microsecond Is an Eternity* (CppCon 2017). My [notes on Gross's talk are here](article.html?slug=when-nanoseconds-matter). Both speakers work at Optiver, tho Carl did move to Citsec. It was a shame that I didn't get to chat with him during my time there. Both talks cover the same problem space. The titles tell you everything you need to know about how the bar moved: in 2017 a microsecond was an eternity. In 2024, nanoseconds.

I'd recommend watching them in this order. Cook in 2017 lays the foundation. Gross in 2024 picks one specific data structure and walks the optimization process end to end on it.

## What Cook actually argues

The framing is direct. In trading, you're competing for the same trades as everyone else. Mean latency doesn't matter. The 99.9th percentile is what loses you money, because that's the day the news drops and you missed the move. The whole rest of the talk is structured around that one observation: how do you compress not just the average path, but the worst path too?

The worldview, summarized:

1. Most of your code is "slow path." Configuration, recovery, logging, error handling. None of it should be near the hot path.
2. The hot path should be one tight loop that does the absolute minimum.
3. The hot path needs to live in cache, in registers, branch-predicted, and inlined. Anything that breaks any of those breaks tail latency.
4. The system calls and synchronization primitives the OS gives you are tools for general-purpose programs. Trading systems are not general-purpose programs.

Everything else in the talk is concrete techniques in service of those four points.

## Hot path discipline

The first half of the talk is essentially a list of "things that look fine and aren't, on the hot path."

- **Virtual functions.** Virtual dispatch is one indirect call, often a vtable cache miss, and an unpredictable branch. Use templates when the type is known at compile time. (Gross hits the same point seven years later, with the specific note that `std::function` does this same thing through type erasure.)
- **Exceptions.** The happy path is fast on most ABIs, but the cold path is enormously expensive, and exception tables bloat your instruction cache. Don't throw on the hot path.
- **Dynamic allocation.** `new`, `malloc`, anything that touches the allocator is a syscall risk and a fragmentation risk and a cache miss. Pre-allocate object pools at startup.
- **`shared_ptr`.** Atomic refcount on copy and destroy, two cache lines (object plus control block), and an indirect call through the deleter. Use `unique_ptr` or, better, manage lifetime by hand inside a pool.
- **`std::map`, `std::list`.** Same point Gross makes. Node-based containers are cache-unfriendly. Use vectors.
- **Branches the predictor cannot predict.** The CPU is great at branches it has seen before. Branches that depend on market data are unpredictable by definition. Cook recommends `__builtin_expect` for hints and removing branches entirely where possible.

The framing throughout is "every one of these is fine in normal code, none of them is fine in five-microsecond code."

## Slow path removal

This is the heart of the talk and the part I most wish I'd internalized before my internship.

The technique is roughly: anything you can pre-compute, pre-compute. Anything you can pre-allocate, pre-allocate. Anything you can pre-decide, pre-decide. The hot path should not contain any work that could have been done at startup.

Concrete examples from the talk:

- Symbol-to-instrument lookups baked into a perfect hash at startup, not computed on every tick.
- Risk limits and order parameters cached as primitive values, not pulled through a config object every time.
- Order templates pre-built so the hot path only fills in price and quantity.
- Logging buffers pre-allocated. The hot path writes to a ring; a separate thread does the I/O.

The reframing is what mattered to me. You don't write the strategy and then "make it fast." You write the strategy with the constraint that everything has to be ready before the tick arrives.

## The always-running pattern

This is the Cook idea I see referenced more than any other. The naive pattern is event-driven: market data arrives, you decide whether it's interesting, if it is you execute the strategy and send an order. The problem is that 99% of ticks are uninteresting, so the strategy code runs rarely. Which means it falls out of cache. Which means when an interesting tick finally arrives, you take cache misses on the path you most needed to be fast.

Cook's solution is to invert it. Run the strategy code on every tick. Compute the order. Build the message. Get all the way to the instruction before the send. Then check whether you actually want to send, and gate that branch. Most of the time you suppress it. But the code path stays hot.

![Two timelines: naive event-driven (sparse runs, mostly cold cache) versus always-running (continuous runs, warm cache, sends gated at the exit)](assets/graphs/always-running-pattern.svg)

This is the trick that keeps tail latency tight. When a real signal arrives, the code has been running for hours. There is nothing cold left to thaw out.

It also generalizes. Anywhere you have a "fast path that runs rarely," you can ask whether you can run it constantly with the side effect suppressed. The cost is some CPU you weren't using anyway. The benefit is that the cache is always warm.

## Templates over polymorphism

Cook makes a strong case for compile-time over runtime polymorphism throughout the talk. Templates let the compiler inline through type boundaries. Virtual calls don't. CRTP, traits, and tag dispatch let you keep the abstraction without paying the runtime cost.

The downside is compile times and worse error messages. He's clear-eyed about it. The trade is worth it for code on the hot path. Not worth it elsewhere.

(Gross echoes this with his note about lambdas vs `std::function`. Keeping the lambda's concrete type lets the compiler optimize through it, while `std::function` collapses everything back to type-erased indirect calls.)

## Pinning, spinning, no syscalls

Threading-wise, the prescriptions are uncompromising:

- Pin the hot-path thread to a specific isolated core. Take that core out of the kernel scheduler entirely if you can.
- Spin instead of blocking. No `epoll`, no `futex`, no `mutex`. The hot thread reads from a memory location until something changes.
- Don't migrate threads across cores. Don't share cache lines you can avoid sharing.
- Be aware of NUMA. Pin memory near the core that uses it.
- Disable hyperthreading on hot cores so the sibling logical core doesn't steal cache or pipeline resources.

The unifying theme: a syscall on the hot path is a tail-latency event. Even a "fast" syscall is hundreds of nanoseconds plus a context switch waiting to happen. Build the system so syscalls only occur on the cold path (startup, shutdown, error recovery).

## Networking

Brief, like in Gross's talk. Same answer: kernel bypass, Solarflare/onload as the easy entry, ef_vi or DPDK when you need the last few hundred nanoseconds. Cook's framing is older but the punchline is identical. The kernel network stack is too slow and too jittery for the hot path.

## How Cook compares to Gross

The two talks are different in scope. Cook is a tour of principles. Gross picks a single data structure (the order book) and walks the optimization process from `std::map` to linear search end to end. They're complementary in the way introductory and advanced talks usually are.

Where they overlap, the message is identical. Mechanical sympathy. No node containers. Kernel bypass. Templates over virtual. Pre-allocate everything. Spin, don't block.

Where they differ, it's mostly that Gross has seven more years of hardware to work with and seven more years of methodology. The branchless binary search bit in Gross's talk would have been a footnote in Cook's. The XRay profiling workflow didn't exist when Cook gave his talk. The data-driven design (look at the update distribution, then design the structure) is a Gross theme more than a Cook theme.

But Cook's "always running" pattern is the older idea that's most clearly load-bearing in modern systems, and Gross doesn't really discuss it. You'd want both.

## What I took away

Two things that Cook makes explicit and Gross more or less assumes:

1. **The hot path is small. Make it really, really small.** Most production code in trading firms has a hot path that's grown to include logging, metrics, configuration lookups, error handling for cases that haven't happened in three years, and deprecated code that nobody removed. Cook's argument is that all of that has to leave. The hot path is twenty lines, maybe fifty. Anything else is the cold path.

2. **Slow path removal is a design principle, not an optimization.** It changes how you write the system. The constraint comes first. The features come second.

I really do wish I'd watched both of these before starting at Citsec. The talks aren't a substitute for working on real systems, but they would have given me the right vocabulary for what I was looking at, and the right questions to ask. If you're heading into HFT or quant systems work, watch them in order. Cook first. Gross second.
