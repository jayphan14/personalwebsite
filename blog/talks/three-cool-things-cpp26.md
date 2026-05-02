I was lucky enough to hear Herb give different versions of this talk three times now. Each time feeling quite inspired and hopeful for the future of C++.

The first was at a WICS event at the University of Waterloo. A teaser version, maybe twenty-thirty minutes. He flashed through three things landing in C++26 and got out before the questions started. Enough to make me curious, not enough to actually understand any of it.

The second was at the Citadel internship offsite, a longer version with, but more hands on and concrete, he was drilling into contracts, which landed in the standard in 2024. It was a simpler feature comparatively, but necessary nevertheless.

The third is the public one, [Three Cool Things in C++26: Safety, Reflection & std::execution](https://www.youtube.com/watch?v=kKbT0Vg3ISw) at C++ on Sea 2025. By this point I'd heard the same three topics three times, and the pieces finally clicked. This is the version I'd point anyone else at if they want to know what's coming in C++26.

Three things, in the order he covers them.

## 1. Safety profiles

The problem: C++ has decades of accumulated undefined behaviour baked into the language. If you're a C++ developer, these UB should be quite familiar. Uninitialized variables, dangling pointers, buffer overflows, integer overflows, type punning, lifetime mistakes. Each of these is a footgun, and over the years the standard library has learned not to fire most of them, but the language still permits them. Modern competitors (Rust, Swift, even modern Java) ship with safer defaults out of the box, and the C++ committee has been catching heat for years over it.

C++26 introduces **safety profiles**: opt-in groups of language rules that the compiler enforces on demand. You can request "no uninitialized reads," "no out-of-bounds access on subscript," "no implicit narrowing," and the compiler refuses to build code that violates them. Profiles are progressive (you can adopt them incrementally) and additive (you can stack them). Existing code keeps building. New code can be locked down.

The reason I'm excited about this is that it aligns with how low-latency C++ work is already done. The Optiver/Citadel/Jane Street style is to ban a lot of "fine in normal code" idioms (raw `new`, exceptions on the hot path, certain casts) at the level of code review. Profiles make that ban a first-class language feature instead of a tribal convention.

The honest caveat: profiles are not memory safety in the Rust sense. They reduce specific classes of footguns. They don't prove correctness across the whole program. Don't expect a borrow checker.

## 2. Reflection

The problem: C++ has had no static reflection for forty years. Want to serialize a struct to JSON? Macros. Want to compare two structs field by field? More macros. Want a debug-print of any aggregate type? Visit-the-tuple tricks. Every "obvious" task that depends on knowing your type's members requires either a code generator, a macro DSL, or external tooling. I've seen our code at Citadel is particularly are full of this kind of "hacks".

C++26 ships **compile-time reflection** (P2996), which gives you proper access to type metadata at compile time. You can iterate over the members of a struct, query their names, check their types, and use that information to generate code without macros.

A flavour of what becomes possible:

```cpp
template<typename T>
std::string to_json(const T& obj) {
    std::string result = "{";
    template for (constexpr auto m : std::meta::nonstatic_data_members_of(^^T)) {
        result += '"' + std::meta::name_of(m) + "\":";
        result += to_json(obj.[:m:]);
        result += ',';
    }
    return result + '}';
}
```
Exciting!

That's a generic JSON serializer in fifteen lines. No macros, no codegen, no boilerplate per type. Just the type itself, examined by the compiler at compile time.

This is the feature I'm personally most excited about (and from the talk, everyone is as well). The macro-and-codegen tax I've paid in trading systems for trivial introspection tasks (logging structs, diffing messages, generating test fixtures) has so hard to get used to at the beginning. Reflection simplifies a lot of that.

## 3. std::execution

The problem: C++ async is a mess. `std::async` defaults to a policy that might never run. `std::future` is awkward to compose. `std::thread` is unstructured (Look at Item 37 in *Effective Modern C++*, I also wrote a book review there). Coroutines work but allocate, and the syntax has its own learning curve. Every codebase ends up with its own ad-hoc async framework.

C++26 introduces **std::execution**, the senders/receivers model originally proposed as P2300. The high-level idea: a *sender* describes work that can be run somewhere, a *receiver* consumes the result, and a *scheduler* decides where work executes. Senders compose with operators (`then`, `when_all`, `let_value`, `bulk`) and the resulting pipeline is type-safe, allocation-free in the common case, and explicit about where each piece runs.

A simple chain:

```cpp
auto work = stdexec::just(42)
          | stdexec::then([](int x) { return x * 2; })
          | stdexec::on(thread_pool.scheduler());

auto [result] = stdexec::sync_wait(work).value();
```

![A senders/receivers pipeline: just(42) feeds then(x*2) feeds on(scheduler) feeds sync_wait, with the chain lazy until the consumer pulls](assets/graphs/senders-receivers.svg)

The chain doesn't run until you ask it to (`sync_wait`), and the scheduler controls where each step happens. No hidden allocation. No "did this start?" ambiguity. No dangling futures.

The appeal is structured concurrency. Async pipelines that have a defined start, a defined end, and clear ownership. The sequencer-style infrastructure I worked on at Citadel was full of hand-rolled async patterns that std::execution would have absorbed cleanly into one composable model.

## What I take away

The three features address very different layers of the language. Safety is at the "what does the compiler refuse to build" layer. Reflection is at the "what can my code know about itself at compile time" layer. std::execution is at the "how do I express asynchronous work" layer. C++26 is genuinely the biggest standard release since C++11, in the sense that each of these reshapes how a slice of code gets written.

Of the three, the one I think will land hardest is reflection. The other two are infrastructural and show up when you opt in. Reflection changes everyday code. The first time you write a generic struct printer in five lines and don't reach for a macro, you'll feel it.

Super excited to see the state of our C++ codebase when I go back to Citsec next year.
