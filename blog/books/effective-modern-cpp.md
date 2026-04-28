A senior engineer at Citsec handed me this book on the first week of my internship. "If you're going to be writing C++ here, read it before you write anything serious." Fair enough.

I picked it up expecting a list of "do this, not that" tips. What I got was more interesting. It's a tour of all the small ways C++11 and C++14 quietly fixed things I didn't know were broken, plus a few things I'd been doing wrong for years without noticing.

These are my notes, more or less in the order Scott Meyers presents them, but written the way I'd explain them to a friend over coffee. 42 items, one page. Some of them I knew. A few of them genuinely surprised me, and I'll flag those.

## Who I'd recommend this book to

People with some familiarity with C++ syntax who want to learn more about best practices. It's not a "learn C++ from scratch" book. It assumes you can already read a class definition and know what a pointer is. Personally, I went through [learncpp.com](https://www.learncpp.com/) before reading this, and that was about the right level of preparation.

## Deducing Types

The book opens with four items on type deduction. Sounds dry until you realize *every* modern feature (`auto`, lambdas, `decltype(auto)`, perfect forwarding) is built on these rules. If they're shaky, everything downstream is shaky.

**Item 1, template type deduction.** There are three flavors based on the parameter form: by value (strips reference, `const`, `volatile`), by reference (keeps `const`, strips reference), and the universal reference `T&&` (lvalues become `T&`, rvalues become `T`).

```cpp
template<typename T> void f(T  param);   // by value: strip ref/cv
template<typename T> void f(T& param);   // ref: keep const
template<typename T> void f(T&& param);  // universal: lvalue→T&, rvalue→T
```

**Item 2, auto type deduction.** Almost identical to template deduction, except for one trap. A braced initializer is deduced as `std::initializer_list`. This was the first thing in the book that made me go *huh.*

```cpp
auto x = 27;          // int, fine
auto y{27};           // std::initializer_list<int>, wait, what?
auto z = {1, 2, 3};   // std::initializer_list<int>
```

I'd written `auto y{27}` plenty of times thinking I was using "uniform initialization" and getting an `int`. I was not getting an `int`.

**Item 3, decltype.** `decltype` reports the *declared* type, references and all. The companion `decltype(auto)` is the only return type that forwards reference-ness through a wrapper.

```cpp
decltype(auto) f() { return container[i]; }  // returns T&, not T
```

If you've ever written a generic accessor that mysteriously returned a copy when you wanted a reference, this is why.

**Item 4, view deduced types.** When in doubt, force a compile error. IDE hovers and `typeid().name()` will lie to you about references and `const`. The compiler won't.

```cpp
template<typename T> class TD;     // declared, not defined
TD<decltype(x)> td;                // error message prints the real type
```

I now use this trick whenever I'm unsure what `auto` deduced. It's faster than reasoning about it.

## auto

**Item 5, prefer auto.** It forces initialization, dodges narrowing, and types lambdas with their actual closure type instead of `std::function` (which has indirect calls and heap allocation hiding inside it).

```cpp
auto cmp = [](int a, int b){ return a < b; };  // unique closure, zero overhead
std::function<bool(int,int)> cmp2 = cmp;       // erased, allocates, indirect-calls
```

**Item 6, but watch out for proxy types.** `std::vector<bool>` doesn't store bools. It packs bits and gives you `vector<bool>::reference` (a proxy) when you index. `auto` faithfully grabs the proxy, which holds pointers into a temporary that's about to die.

```cpp
auto highPriority = makeFlags()[5];  // proxy referring to a destroyed temp
```

This was the second "oh no" moment for me. I'd been told `vector<bool>` was weird, but I'd never connected it to `auto`. The fix is the explicitly typed initializer idiom: `auto x = static_cast<bool>(...)`.

## Moving to Modern C++

This chapter is the heart of the book. Eleven items that quietly fix things the language used to handle badly.

**Item 7, `()` vs `{}`.** Braces forbid narrowing and dodge the most-vexing-parse, but they aggressively prefer `initializer_list` constructors. The two are not interchangeable.

```cpp
std::vector<int> v1(10, 20);  // ten 20s
std::vector<int> v2{10, 20};  // two ints: 10 and 20
```

I'd vaguely thought "always use braces" was the modern advice. It isn't. Pick deliberately.

**Item 8, `nullptr`, not `0` or `NULL`.** `nullptr` has type `std::nullptr_t` and converts to any pointer but never to an integer. This makes overload resolution and template deduction actually work.

```cpp
void f(int);
void f(void*);
f(0);        // calls f(int), surprise
f(nullptr);  // calls f(void*), what you meant
```

**Item 9, alias declarations beat typedefs.** Aliases template directly, which means no `typename ... ::type` boilerplate.

```cpp
template<typename T> using AllocList = std::list<T, MyAlloc<T>>;
AllocList<int> l;   // clean, no `typename`
```

Small thing, but in heavy template code it really cleans up the noise.

**Item 10, scoped enums.** `enum class` doesn't leak names into the enclosing namespace and refuses to silently convert to `int`. The old unscoped enums did both, which is responsible for a depressing number of shipped bugs.

```cpp
enum class Color { red, green, blue };
int x = Color::red;                 // error
int y = static_cast<int>(Color::red); // explicit
```

**Item 11, `=delete` instead of private-undefined.** The old "declare private, never define" trick fails at link time, only works inside classes, and gives terrible error messages. `=delete` works at namespace scope, on any function, and fails at compile time with a clear message.

```cpp
void process(int);
void process(double) = delete;  // ban implicit double→int promotions
```

The fact you can use `=delete` to ban specific overloads (not just copy/move) was new to me.

**Item 12, always write `override`.** Catches the "I tried to override but my signature didn't match" bug at compile time instead of runtime.

```cpp
struct Base    { virtual void f(int); };
struct Derived : Base {
    void f(long) override;   // error, doesn't override anything
};
```

Before `override`, that mistake would silently create a *new* virtual and your `Base*->f()` would call the base class. Painful.

**Item 13, prefer const_iterators.** Use `cbegin`/`cend` (free functions in C++14) when you don't intend to mutate. It's cheap, it's the right intent, and it makes generic code work on more containers.

**Item 14, `noexcept` matters more than you think.** Specifically, `std::vector` will only move-instead-of-copy on resize if the move constructor is `noexcept`. Forget the keyword and your vector silently degrades from O(1) move to O(n) copy on every reallocation.

```cpp
Widget(Widget&&) noexcept;             // vector will move on resize
Widget& operator=(Widget&&) noexcept;
```

This one stuck with me. It's a rare case where one keyword is the difference between "fast" and "sneakily slow."

**Item 15, `constexpr` whenever possible.** Lets values move from runtime to compile time, and `constexpr` functions work in both contexts depending on their arguments.

```cpp
constexpr int pow(int b, int e) {
    return e == 0 ? 1 : b * pow(b, e - 1);
}
std::array<int, pow(2, 10)> arr;   // size known at compile time
```

**Item 16, `const` member functions must be thread-safe.** Modern users assume `const` means safe to call concurrently. If you're caching internally through `mutable`, you owe them a mutex (or atomics).

```cpp
mutable std::mutex m;
mutable std::optional<Result> cache;
const Result& get() const {
    std::lock_guard<std::mutex> g(m);
    if (!cache) cache = compute();
    return *cache;
}
```

I didn't fully appreciate this convention until I read the item. It's a load-bearing assumption baked into how the standard library and most modern code is used.

**Item 17, special member function generation.** Declaring *any* of the destructor or copy/move operations changes which others are auto-generated. Most importantly, if you declare a destructor, the compiler will *not* auto-generate move operations.

```cpp
class Widget {
public:
    ~Widget();   // implicit move ops? gone.
};
```

This is sneaky. You add a destructor for one logging line, and suddenly your class is copying instead of moving everywhere. The fix is `=default` to be explicit about what you want.

## Smart Pointers

I went into this chapter thinking I knew smart pointers. I came out realizing I'd been reaching for `shared_ptr` too often.

**Item 18, `unique_ptr` is the default.** Same size as a raw pointer, no atomics, move-only. Reach for this first.

```cpp
auto w = std::make_unique<Widget>();
auto w2 = std::move(w);   // ownership transferred
```

**Item 19, `shared_ptr` only when ownership is genuinely shared.** It's twice the size of a raw pointer, the refcount lives in a separately allocated control block, and every copy/destroy is an atomic operation. It's not free.

**Item 20, `weak_ptr` for observation without ownership.** Breaks cycles, models caches and observers honestly, and `lock()` tells you whether the object is still alive.

```cpp
std::weak_ptr<Widget> wp = sp;
if (auto live = wp.lock()) live->use();   // null if expired
```

**Item 21, `make_unique` and `make_shared` over raw `new`.** Two reasons. First, exception safety. `f(shared_ptr<T>(new T), g())` can leak if `g()` throws between the `new` and the `shared_ptr` constructor. Second, `make_shared` collapses two heap allocations into one.

```cpp
auto sp = std::make_shared<Widget>(args);     // 1 allocation
std::shared_ptr<Widget> sp2(new Widget(...)); // 2 + leak risk
```

**Item 22, Pimpl + `unique_ptr` needs out-of-line special members.** This one I'd hit in real code. `unique_ptr<T>`'s default deleter requires a complete `T`, and the destructor implicitly calls the deleter. So if your class destructor is implicit (defined in the header), it sees an incomplete `Impl` and explodes with a `static_assert`.

```cpp
// header
class Widget {
    struct Impl;
    std::unique_ptr<Impl> p;
public:
    Widget();
    ~Widget();   // declared only
};
// .cpp, where Impl is complete
struct Widget::Impl { /* ... */ };
Widget::~Widget() = default;
```

The error message when you get this wrong is genuinely awful. Knowing the rule saved me an afternoon the next time I hit it.

## Rvalue References, Move Semantics, Perfect Forwarding

This is the densest chapter, and the one where I learned the most.

**Item 23, `std::move` and `std::forward` are casts.** They don't move or forward anything. `move` unconditionally casts to rvalue. `forward` conditionally casts based on the original argument category. The actual move work lives in the move constructor.

The mental model that finally clicked for me: `std::move` is a request, not a command.

**Item 24, universal references vs rvalue references.** `T&&` is a universal reference *only* when `T` is a deduced template parameter (or `auto&&`). Otherwise it's a plain rvalue reference. They behave completely differently and the syntax is identical.

```cpp
template<typename T> void f(T&& x);  // universal
void g(Widget&& x);                  // rvalue ref, no deduction
auto&& z = expr;                     // universal
```

I'd been calling all `T&&` "rvalue references" and getting confused about when calls with lvalues compiled. They compiled because half of them weren't actually rvalue references.

**Item 25, `move` on rvalue refs, `forward` on universal refs.** Mix these up and you either over-move (corrupting lvalues someone passed in) or under-move (losing perf).

```cpp
Widget(Widget&& rhs) : name_(std::move(rhs.name_)) {}

template<typename T>
void setName(T&& name) { name_ = std::forward<T>(name); }
```

**Item 26, don't overload on universal references.** A `T&&` template often binds *better* than your normal overloads, hijacking calls you didn't expect.

```cpp
void log(int);
template<typename T> void log(T&& x);
log(short(1));   // template wins, not log(int), surprise
```

I was guilty of this. It looks innocent. "I'll add a perfect-forwarding overload for the rare types." Then it eats every other call site and you can't figure out why.

**Item 27, alternatives.** Tag dispatch, `std::enable_if` constraints, or just pass by value. Concepts (post-C++14) make this even cleaner.

**Item 28, reference collapsing.** `T& &`, `T& &&`, and `T&& &` all collapse to `T&`. Only `T&& &&` stays `T&&`. This rule is the entire reason `std::forward` works. It's worth memorizing.

**Item 29, assume moves are not present, not cheap, and not used.** Every "moves are free" tutorial is half a lie. `std::array` moves element-by-element (O(n)). `std::string` with SSO copies the small buffer. Many third-party types still don't have move ops at all.

This was a healthy reality check. I'd been writing generic code that assumed move was always cheap. It often isn't.

**Item 30, perfect forwarding failure cases.** Braced initializers can't be deduced. `0` and `NULL` deduce as `int`, not pointer. Declaration-only static const members fail to link. Overloaded function names can't be resolved. Bitfields can't be bound to references.

```cpp
template<typename... Ts> void fwd(Ts&&...);
fwd({1,2,3});   // fail, initializer_list can't be deduced
fwd(NULL);      // fail, deduces as int
```

Forwarding "just works" until it doesn't. Knowing the failure modes saves a confused hour staring at error messages.

## Lambdas

**Item 31, avoid default capture modes.** `[&]` captures references that can outlive their referents. `[=]` captures `this` by raw pointer (and the *enclosing object* hangs on by that thread).

```cpp
auto bad  = [&]{ return localVar; };   // dangles
auto good = [localVar]{ return localVar; };
```

**Item 32, init capture for moving into closures.** Before C++14 you couldn't move-capture a `unique_ptr`. C++14 fixed it.

```cpp
auto p = std::make_unique<Widget>();
auto f = [p = std::move(p)]{ p->use(); };
```

**Item 33, `decltype` on `auto&&` to forward correctly.** Generic lambdas use `auto&&`, but `std::forward` needs a type name. `decltype` provides one.

```cpp
auto f = [](auto&& x) {
    return g(std::forward<decltype(x)>(x));
};
```

**Item 34, lambdas over `std::bind`.** Lambdas are clearer, faster, and don't have `bind`'s "when does this argument get evaluated" gotcha.

```cpp
auto f = [t = steady_clock::now() + 1h]{ ring(t); };  // explicit
auto g = std::bind(ring, steady_clock::now() + 1h);   // when did 'now' run?
```

I confess I'd long stopped using `bind` already, but I'd never been able to articulate *why* lambdas were better. Now I can.

## Concurrency

The concurrency chapter is short but spicy. The defaults are not what you'd guess.

**Item 35, task-based, not thread-based.** `std::async` returns a `future` that propagates exceptions back, and the runtime decides whether to spawn a thread or reuse one. Raw `std::thread` makes you manage joinability, oversubscription, and exception propagation by hand.

**Item 36, specify `std::launch::async` if you mean it.** This was a genuine surprise. The default policy is `async | deferred`, meaning the work *might never start* until somebody calls `get()`. And if it's deferred, it'll run on the *calling* thread.

```cpp
auto fut = std::async(std::launch::async, work);  // actually async
auto fut = std::async(work);                       // maybe never runs
```

If you want fire-and-forget behavior with the default policy, you don't get it. The runtime is allowed to defer forever.

**Item 37, `std::thread`s must be unjoinable on every path.** A joinable thread that goes out of scope calls `std::terminate`. Always join, detach, or wrap in an RAII guard. And remember "every path" includes exception unwinding.

**Item 38, future destructors vary.** A `future` from `std::async(launch::async)` *blocks* in its destructor until the task finishes. Other futures don't.

```cpp
{
    auto f = std::async(std::launch::async, slow);
}   // this brace blocks until slow() returns
```

An innocent-looking RAII scope can secretly become a join point. I'd never noticed this distinction before reading the item.

**Item 39, `void` futures for one-shot events.** A `promise<void>`/`future<void>` pair beats a condition variable plus a flag for one-time signals. Condvars have lost-wakeup and spurious-wake hazards. Futures express "this happens exactly once" precisely.

**Item 40, `atomic` for concurrency, `volatile` for special memory.** A whole generation of programmers conflated these. They solve different problems. `volatile` tells the compiler "don't optimize away accesses to this memory" (memory-mapped I/O, signal handlers). It does not provide thread safety. `atomic` is what you want for cross-thread communication.

## Tweaks

The book closes with two items on parameter passing, which felt like footnotes until I thought about them.

**Item 41, pass by value for sink parameters.** When a function unconditionally stores its argument and the type is cheap to move, taking by value handles both lvalue and rvalue callers acceptably with one signature.

```cpp
class Widget {
    std::string name;
public:
    void setName(std::string n) { name = std::move(n); }
};
```

The alternative is two overloads (`const&` and `&&`), which is more code for slightly better performance. By-value is the better tradeoff in most cases.

**Item 42, emplace over insert.** `emplace_back` constructs the element in place from arguments, skipping the temporary that `push_back` would build.

```cpp
v.push_back("hi");      // build temporary string, move into vector
v.emplace_back("hi");   // construct string directly in vector
```

Most useful when the constructor is non-implicit or the type is expensive to move. Less useful when the value already exists in the right type.
