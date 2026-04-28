I picked up *Developing High-Frequency Trading Systems* (Donadio, Ghosh, Rossier, Packt) right after I found out I'd be interning at Citadel Securities and Citadel last summer. I had no real intuition for how this stuff fit together. I knew C++, I'd read about market making in passing, but the gap between "I understand a limit order" and "here is what an HFT firm actually builds" felt enormous. The book seemed like the right bridge.

It mostly was. It taught me the basics. But by the time I finished, I was left wanting more. A lot of the chapters scratch the surface and stop right where the interesting questions start. That's not really a knock on the book. There's only so much you can fit in 350 pages, and the field is famously secretive. I just want to set expectations: this is an *introduction*, not a deep dive.

## Who I'd recommend this book to

Students or engineers heading into a quant/HFT role who want a mental model of the system before day one. People with a CS background who can read C++ and have a vague sense of what an order book is, but have never seen the architecture spelled out. If you already know what kernel bypass, busy-spinning, and FIX are, you'll find most chapters too thin. If you don't, this is a reasonable place to start.

## What's actually in a trading system

The first few chapters lay out the boxes-and-arrows view of an HFT system. Market data comes in from the exchange, gets decoded into an internal representation, the strategy decides what to do, the order goes through risk checks, the gateway encodes it back into the exchange's wire format, and out it goes.

![HFT system architecture: feed handler, strategy, OMS/risk, order gateway, exchange](assets/graphs/hft-architecture.svg)

The bit that took me a moment to internalize is that the whole loop runs continuously and the components are usually colocated on the same machine (sometimes the same NUMA node, sometimes pinned to specific cores) to avoid network hops between them. Logging and metrics are almost always *off* the critical path. You don't want to wait for a write to disk before sending an order.

The book covers each box in a chapter. Useful starting point. The descriptions are necessarily abstract.

## Latency: where the microseconds actually go

The chapters on optimization (hardware, OS, networking, language choice) are the most concrete in the book. The mental model that stuck with me is the tick-to-trade pipeline: the time between a market data packet hitting your NIC and your order leaving your NIC.

![Tick-to-trade pipeline with rough latency contributions per stage](assets/graphs/tick-to-trade.svg)

Every stage is a target for optimization. The book walks through:

- **Kernel bypass** (DPDK, Solarflare/Onload, ef_vi). The kernel network stack is too slow and too jittery, so HFT shops talk to the NIC from userspace.
- **Busy spinning instead of blocking.** No `epoll`, no syscalls in the hot path, just a thread pinned to a core reading a ring buffer.
- **Cache locality.** Hot data structures sized to fit L1/L2, false-sharing avoidance, NUMA-aware allocation.
- **Branch prediction and code layout.** Mark cold paths cold. Keep the hot path linear.
- **Lock-free queues** between producer and consumer threads (SPSC ring buffers, mostly).
- **FPGAs** for the very front of the pipeline (decode, simple book-building, even simple strategies). The book introduces this but doesn't go deep.

The C++ chapter is a tour of latency-conscious idioms: avoid heap allocation on the hot path, prefer flat data layouts, beware virtual calls in tight loops, watch out for `std::shared_ptr`'s atomic refcount when you don't need sharing. None of this is wrong, but if you've read *Effective Modern C++* you've seen most of it framed better.

## Strategy: the part where the book pulls its punches

There's a chapter on strategies (market making, statistical arbitrage, latency arbitrage, momentum), and it's the chapter I had the highest hopes for. It's also the thinnest. You get a paragraph or two on each, an equation or two, and that's about it.

I think this is genuinely unavoidable. Real strategies are the proprietary thing. No firm is going to publish theirs, and a textbook can't substitute for what a research team builds over years. But it does mean the chapter feels like a list of names, not an explanation.

## The other languages

There are chapters on Java (and JVM tuning, GC pause avoidance, JIT warmup) and Python (mostly as a research/analytics language, with notes on Cython and numpy and how to call into C++). Both are fine surveys. The Java chapter was the most useful to me because I had less context there. The discussion of *why* you'd choose Java for an HFT system despite the GC, and the specific tricks (off-heap memory, `Unsafe`, low-pause collectors), was new.

The Python chapter is mostly "Python is for research and tooling, not the hot path." Which, fine. True.

## Machine learning

The book ends with a chapter on ML in HFT. It's the most speculative chapter and also feels the most rushed. The summary, more or less, is "people are trying it for short-horizon prediction, feature engineering still matters more than model choice, and inference latency is the binding constraint." Not wrong, but you could write that paragraph without reading the chapter.

## Reflection

This book teaches the basics of how things are *supposed* to be done. Clean diagrams, clean stages, clean separation of concerns. Read it, work through the examples, and you'll have a coherent mental model of what an HFT system looks like on paper.

When I went to intern at Citsec and Citadel, I saw that the reality is much messier. Code that's been live for a decade. Components named after people who left in 2014. Latency optimizations that started as a hack and became load-bearing. The diagrams in this post are real, but they're the cleaned-up version. The actual systems carry the weight of every decision someone made on a Tuesday afternoon when something was on fire.

Out of respect for confidentiality I won't go further than that. Read the book for the foundation, and accept that the rest only makes sense once you've sat in front of the real thing.
