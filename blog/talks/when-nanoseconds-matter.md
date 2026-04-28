I watched [David Gross's *When Nanoseconds Matter: Ultrafast Trading Systems in C++*](https://www.youtube.com/watch?v=sX2nF1fW7kI) (CppCon 2024) after my internship at Citsec was already over. I just wished I'd found it before. A lot of what he talks about would have saved me a few "wait, why is this fast" or "wait, why is this slow" moments while I was actually hours staring at my flamegraph. Better late than never I guess.

Gross is at Optiver. The talk is engineering-flavored, not theoretical. He picks a key data structure (an order book, which I also tried to optimzized at Citsec), shows the obvious implementation, then walks through why the obvious implementation is bad, and what you do about it. Along the way he sprinkles in nine principles he's collected over a decade in the industry. I'll go through the talk roughly in his order, but pulled apart so the principles stand out.

## Why low latency at Optiver, Citsec, JS, HRT, ... ?

He breaks the "why fast" question into two pieces. The first is the obvious one. News comes out, you need to react before someone else does, otherwise your prices are stale and you trade against people who know more than you. The second is less obvious: you also need to be *accurate*. Markets generate a constant flow of information, and your strategy is only as accurate as the freshest data it has seen. Slow ingestion means lagged signals means worse decisions, even before you start sending orders.

He also addresses the "but FPGAs exist, why bother with software" question early. FPGAs are great for a narrow front of the pipeline (decode, simple book-building, simple rules), but they're expensive to engineer and operationally painful. Software is flexible. The interesting part is that even when an FPGA is in the loop, the strategy that programs the FPGA's rules is itself running on software with a low-latency requirement. The FPGA is being told "if price > 10, cancel my order," and that *if* clause has to stay current.

## The order book

The data structure he picks for the talk is the order book. It's a great choice because every trading system has one, and it's small enough to study end to end.

The book has bids and asks, each side ordered. The API is roughly:

```cpp
add(id, price, volume)
modify(id, new_volume)
delete(id)
```

The `delete` and `modify` only get an id, so you need a hashmap from id to level no matter what. He sets that aside. The interesting question is what to use for the levels themselves.

### Implementation 1: std::map

The natural choice. Two `std::map`s, one for bids, one for asks. Iterators stay valid across the operations he's doing, so you can stash the iterator inside the hashmap entry and skip a second lookup. Complexity-wise it's about as good as you can get on paper.

In practice the latency distribution is bimodal and has a fat tail. One peak from the operations that hit only the hashmap, another from operations that walk the tree. And the tree walk is doing a binary search through nodes scattered all over the heap. Cache locality is bad, and the prefetcher can't help.

The first principle: **don't reach for node containers**. `std::map`, `std::set`, `std::unordered_map`, `std::unordered_set`, `std::list`. They're convenient, the complexity looks good in textbooks, and they're awful for hot-path work because every node is a separate allocation. He quotes a Sean Parent talk where Adobe Photoshop used `std::vector` for ~90% of everything, not because they didn't need other structures, but because the performance argument always won.

### Implementation 2: std::vector + lower_bound

So you replace `std::map` with a sorted `std::vector` and binary-search it. Cache locality is much better. The latency distribution gets a single peak, but with a long fat tail.

He pauses on this. The tail is the interesting part. Why does it exist?

Because of how book updates are actually distributed. He pulls a histogram of updates by depth from real Nvidia market data: the action is overwhelmingly on the top of the book, and the distribution is exponential. Almost every update touches the best price or the level next to it. If your vector has the best price at index 0 (which is the intuitive layout), every update at the top of the book shifts most of the vector's contents in memory. That's the tail.

Second principle: **a problem well stated is half solved**. You can't optimize a data structure without looking at the data going through it.

### Implementation 3: std::vector, reversed

Tiny code change. Put the best price at the *end* of the vector instead of the beginning. Now top-of-book updates touch the tail, where there's nothing to shift. The fat tail in the latency distribution disappears completely.

![Order book latency distributions: std::map (bimodal, fat tail), std::vector forward (tail), std::vector reversed (clean)](assets/graphs/orderbook-latency-distributions.svg)

Third principle: **leverage the specific properties of your problem**. The skewed update distribution wasn't an accident, it was the dominant feature, and the implementation should be designed around it.

### Implementation 4: linear search

This is the part that's a little anticlimactic in a good way. After the reversed vector with binary search, he goes branchless to remove the conditional jumps that were eating 30%+ of CPU time in `std::lower_bound`. That gets a measurable win but introduces a cost (branchless binary search has no early exit, so it touches more memory).

Then he tries plain linear search. And linear search beats everything. The book typically has on the order of a thousand levels per side, but most of the action is concentrated at one end, the prefetcher loves a linear walk, the branch predictor handles the loop trivially, and there's no early-exit/branch tradeoff to fight.

Fourth principle: **when it's fast and simple, you're done**. He frames this as "when you know you've done your job well as an engineer." Don't keep optimizing because the result feels too plain. Plain *is* the result.

Fifth principle: **mechanical sympathy**. Linear search is in harmony with the hardware: cache-friendly, prefetcher-friendly, branch-friendly. Algorithms that have low theoretical complexity but fight the hardware lose to algorithms that match it.

## Profiling the way he does it

The profiling section is one of the most useful parts of the talk for me, because it's all stuff I'd half-known but never seen put together.

His sequence is:

1. **`perf stat` first.** Look at the four top-down categories from Intel's microarchitecture analysis: retiring, bad speculation, front-end bound, back-end bound. They have very little overlap and cover everything the CPU is doing. He cautions against intuition: don't start by hunting cache misses. Start by measuring all four and seeing which one is high.

2. **`perf record` next.** Sampling profiler. Drops you into the assembly with annotations. In his order-book example, this is what surfaces that `std::lower_bound`'s two conditional jumps are eating 30% of the CPU time, which motivates the branchless variant.

3. **Hardware counters programmatically.** Wrap the specific section with calls that read the counters before and after. Validates whatever theory you have from the previous steps.

4. **Clang's XRay for event-driven systems.** This is the trick I most wish I'd known. In an event loop where the interesting work happens inside short functions, regular sampling profilers miss the work because samples land in the polling loop. Instead of manually adding TSC reads to every function (which doesn't scale), compile with XRay instrumentation. It adds nops at function entry/exit. By default they cost nothing. When you want to profile, you patch the binary to replace the nops with calls, no recompile needed.

The lesson is that you have to match the profiler to the workload. `perf record` doesn't help you with three-microsecond functions inside a busy poll loop.

## Networking, briefly

He's careful to keep the networking section short ("we're at CppCon"), but the takeaways are clear:

- **Bypass the kernel.** Solarflare/onload is a drop-in for BSD sockets via `LD_PRELOAD`. TCP-direct gives you userspace TCP. ef_vi (or DPDK on Intel) is the layer-2 API and the fastest, at the cost of doing buffer management yourself.
- **Use shared memory inside a host.** Once you're on the same box, you don't need sockets, you need memory. One writer, many readers. Continuous arrays. Cap'n Proto-style headers with a name, magic number, and version. Multi-process, not because monolithic threads can't share data, but because operationally you don't want one strategy crashing to take down all of them.

Sixth principle: **be mindful of what you're using**. The Linux kernel is a beautiful piece of machinery, but you should only use it when you actually need it.

## The shared-memory queue

This is the section that runs the longest in the talk and was the most useful to me. The constraints on the queue are specific:

- One producer, many consumers.
- Bounded, no resizing, no blocking on slow consumers (a slow consumer must not stall the producer, because that's the whole trading system).
- Variable-length messages.
- Fan-out (broadcast), not load-balance.
- Supports POD types directly, no pointer chasing.

The header is two atomic counters: a `write_counter` and a `read_counter`. The producer touches both. Consumers only read both. They live on separate cache lines to avoid false sharing. They count *bytes*, not slots, and grow from zero to infinity (you wrap around inside the buffer).

The write sequence is: advance `write_counter`, copy the data, then advance `read_counter`. Readers check `read_counter` is far enough ahead, copy via `std::memcpy` (specifically `memcpy`, to avoid strict aliasing and alignment issues), then re-check `write_counter` to detect overflow. There's a data race here in the language sense (consumers `memcpy` over bytes the producer is concurrently writing), and the algorithm catches it after the fact. He acknowledges this is a real C++ problem and points at the `atomic_memcpy` proposal as the eventual fix.

The optimizations that matter most:

- **Don't touch the write counter on every message.** Reserve a chunk (he uses 100 KB) at a time and bump the counter once. Consumers see slightly less data, but the contention drops by orders of magnitude.
- **Align on 8 bytes, not on the cache line.** Cache-line alignment of every element wastes locality. Atomics get their own cache lines, but the data does not.
- **Cache the read counter in the consumer.** If you already know there's 1 MB available and you've only consumed 1 KB, don't re-read.

His benchmark beats Aeron and Disruptor across most consumer counts, in ~150 lines of code. The point isn't "everyone should write their own queue." The point is the alternative is often 100,000 lines of framework for something that should fit on a few screens.

Seventh principle: **right tool for the right task**. Concurrent queues have very different designs. Yours has to match your constraints exactly.

## Staying fast

After all of this you've got a fast system. Eighth principle: **it's nice to be fast, but staying fast is harder**. Throw millions of measurements per second into a database, build dashboards, but most importantly *write alerts*. The kind of alert that fires when a percentile slips. Without the alerts, the dashboards get watched on day one and forgotten by month six.

## You're not alone

The closing section was the part I found most useful, and the part I'd most clearly underestimated. He runs a benchmark that randomly walks an array of varying size while measuring throughput. With one process pinned to one core, you see the three cache levels clearly (sharp drops past L1, L2, L3). With six processes running on six different cores, the throughput per worker matches the single-worker case *except* in the L3 region, where contention crushes scaling.

His point: most trading systems don't fit in L1 or L2. They live in L3. And L3 is shared. You can micro-optimize a single application all you want, but if every other application on the box is also living in L3, your real-world performance is bounded by *everyone's* footprint, not just yours.

Ninth principle: **empathy for the system as a whole**. You aren't just responsible for the performance of your code, you're responsible for it as a citizen of the box.

## Reflecting

Everything in the talk maps back to the same handful of ideas:

1. Don't use node containers in hot paths.
2. Look at the data before optimizing.
3. Design around the dominant property of your problem.
4. Simple solutions that match the hardware win.
5. Mechanical sympathy beats theoretical complexity.
6. Use the kernel only when you have to.
7. Pick the queue that fits the constraints, not the most general one.
8. Build alerts so you stay fast.
9. Optimize for the box, not just the binary.

Reading this list it sounds obvious. Watching the talk is what makes it stick, because you see each principle land on a concrete decision and shave off a real chunk of latency.

What I most wish I'd had during my internship is the profiling sequence (top-down → perf record → hardware counters → XRay) and the framing of "look at the data first." I'd been reaching for `perf record` straight away, which surfaces the symptom but not the diagnosis. And I'd never thought of cache contention as a *system* property rather than an *application* property.

If you write low-latency C++ for a living, watch the talk. If you're heading to a quant or HFT internship, watch it before you start.
