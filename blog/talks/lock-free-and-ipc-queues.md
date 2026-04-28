My project at Citadel was on the sequencer system. The sequencer is the central message bus for the trading stack. Every app that wants to talk to every other app does it by writing to the bus and reading from the bus. Apps publish messages, the bus assigns ordering, and every subscriber sees the same ordered stream. Under the hood the bus is an MPMC queue in shared memory, and the entire trading system is built on top of this one structure.

For most of the internship I was working with the sequencer without really understanding it deeply. Two talks I watched after I left finally made it click: Charles Frasch's *Single Producer Single Consumer Lock-free FIFO From the Ground Up* (CppCon 2023) and Jody Hagins' *Building Robust Inter-Process Queues in C++* (C++ on Sea 2025). They cover different layers of the same problem and together they're the most useful pair of talks I've watched on this material.

## What a sequencer actually is

If you haven't seen the pattern: a sequencer system replaces process-to-process messaging with one shared bus. Every app that wants to publish writes to the bus. Every app that wants to subscribe reads from the bus. The bus assigns a strictly monotonic sequence number to each message, so subscribers can detect gaps, replay deterministically, and reason about ordering across producers without coordinating with each other.

![Sequencer pattern: producer apps publishing into a shared-memory ring, subscriber apps reading from it, monotonic sequence numbers tying the order together](assets/graphs/sequencer-bus.svg)

The bus itself is one shared-memory ring buffer with atomic indices. Many writers, many readers. Crash-survivable enough that one bad app doesn't take the whole system down. Fast enough that the round-trip from "App A publishes" to "App B sees the message" is on the order of microseconds.

That's a lot of properties to want from a single structure. Hence the two talks.

## Frasch: the inside of the queue

Frasch's talk is the foundation. He starts with a textbook ring buffer protected by a mutex, runs a benchmark, and walks through every step of getting it lock-free and fast. Each step is measured.

The progression, roughly:

1. **Mutex-protected queue.** Correct, simple, slow.
2. **Atomic indices with sequential consistency.** Correct and lock-free, but `seq_cst` issues full memory barriers on every operation. Way more synchronisation than you need.
3. **Acquire/release ordering.** Producer releases on store, consumer acquires on load. The hardware does only the synchronisation that the data dependency requires. Substantial throughput win.
4. **Cache-line align the indices.** Without padding, the producer's write index and the consumer's read index land in the same cache line. Every update from one side invalidates the line on the other. Pad each index to its own line and the false sharing disappears.
5. **Cache the opposite index locally.** The single biggest jump in his benchmarks, and the optimisation I most wish I'd understood earlier. The producer needs the consumer's read index only to know whether the queue is full. Instead of atomic-loading it on every push, cache it locally and only re-load when the cached value claims the queue is full. Most of the time you're not full, the cache says you're not full, and you skip the atomic load entirely. Same idea on the consumer side for emptiness. Cache-line ping-pong drops dramatically.

The cached-index trick in code is just this:

```cpp
class Producer {
    std::atomic<size_t>& read_index_;
    std::atomic<size_t>& write_index_;
    size_t cached_read_ = 0;          // local, not atomic

    bool push(T value) {
        const auto w    = write_index_.load(std::memory_order_relaxed);
        const auto next = (w + 1) % capacity;

        if (next == cached_read_) {
            // looks full; refresh the local cache once
            cached_read_ = read_index_.load(std::memory_order_acquire);
            if (next == cached_read_) return false;   // really full
        }

        buffer_[w] = std::move(value);
        write_index_.store(next, std::memory_order_release);
        return true;
    }
};
```

I'd seen exactly this pattern in the sequencer code at Citadel without really getting why it was there. After Frasch, it's obvious.

The talk is SPSC, but everything you learn here is foundational for MPMC. Memory ordering, cache lines, false sharing, the cost of an atomic load vs reading a cached local. They all transfer to multi-producer designs, where the "claim the next slot" step usually becomes a `fetch_add` or a CAS loop instead of a plain store, but the surrounding ideas are the same.

## Hagins: the outside of the queue

The Hagins talk addresses the next layer up. Once you have a working concurrent queue, what does it take to make it work *between processes* instead of between threads, and to make it survive operationally? That's the central message bus problem.

The same memory ordering rules apply. But several new concerns enter the picture:

- **Mapping and lifecycle.** The shared memory has to be created by someone, mapped by everyone, and unlinked at the right time. Who creates it? Who unlinks? What happens when the creator dies first, or when a new subscriber maps a region whose creator is already gone?
- **Crash survival.** A producer can die mid-write, leaving a slot half-finished. A consumer can die mid-read. The other processes have to detect the partial state, ignore it, and keep going. The queue's state machine has to be robust against any single participant dying at any point.
- **Layout stability.** Atomics on shared memory work fine, but only if every process agrees on layout, alignment, and atomic implementation. Cross-compiler-version drift, struct padding differences, and ABI changes can corrupt the queue silently.
- **Schema versioning.** When the message format changes, processes built at different times need a way to detect the mismatch and either upgrade or fail safely. The trading system runs forever; the schema does not.
- **Polling vs signalling across processes.** Inside one process a condition variable wakes a waiter. Across processes your options narrow. For low-latency you usually want busy-spin on a memory location, which Frasch's framework supports natively.

The Hagins framing is "robust" because none of this is the fast-path performance question. It's the operational question of what happens when something goes wrong. In a trading system that runs continuously and includes apps with very different reliability characteristics, this matters as much as the throughput number.

## Where the two talks meet

The reason these two talks together were the right pair for understanding the sequencer is that they correspond to two genuinely separable concerns stacked on top of each other.

**Frasch is the inside of the queue.** Atomic indices, memory ordering, cache-line alignment, the cached-index optimisation. The properties you need to get right for the queue to be correct and fast as a piece of code.

**Hagins is the outside of the queue.** How the queue lives in shared memory across multiple processes, how it survives crashes, how it handles versioning, how it integrates with the lifecycle of apps that join and leave. The properties you need to get right for the queue to function as a piece of infrastructure.

The sequencer is both. Frasch concerns are present in every push and pop. Hagins concerns are present every time the system starts, an app dies, a deployment rolls out, or a schema version changes. The two are orthogonal and you need both right.

## Things that clicked specifically

A handful of small things that resolved confusions I'd had during the internship:

- The `seq_cst` vs acquire/release distinction. I'd been treating "atomic" as one binary property. Frasch made it specific: the cost is in the *ordering*, not the *atomicity*, and you usually need less ordering than you think.
- Why every cache-line-aligned struct in the sequencer code had ~50 bytes of explicit padding. False sharing.
- Why the consumer cached `last_known_write_index` as a non-atomic local. To skip atomic loads in the common case.
- Why some queues in the codebase used sequence numbers as both data and synchronisation, with publishers writing the payload first and the sequence number last. Hagins-style robustness: a consumer that sees an old sequence number is reading old data; a consumer that sees a new sequence number knows the data behind it has already been written.
- Why a slow subscriber didn't hold up the publisher. The publisher's view of each subscriber's read index lives in shared memory, and a subscriber falling behind just means it stops keeping up, not that the publisher blocks. That was a Hagins-flavoured operational decision, not a Frasch-flavoured performance decision.

## Reflection

I keep coming back to this framing of "inside the queue" vs "outside the queue." Most queue talks I'd watched before only covered one half. Frasch did the inside very thoroughly. Hagins did the outside. Once I had both pictures, the sequencer stopped feeling like a magical opaque thing and started feeling like a structure I could reason about.

If you're heading into IPC, low-latency systems, or trading infrastructure work, watching these in this order would have saved me a few weeks of slow-motion confusion during the internship. Frasch first, to learn what an atomic ring buffer actually is. Hagins second, to learn what it takes for the ring buffer to live in production.
