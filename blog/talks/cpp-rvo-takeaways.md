Short post on a short topic. Watched [Michelle Fae D'Souza's talk on RVO in Bloomberg's C++ codebases](https://www.youtube.com/watch?v=WyxUilrR6fU&t=659s) and the value is in a small set of takeaways worth committing to muscle memory.

The headline: **just return the local. The compiler will do the right thing.** Most "optimizations" people add to return statements actively prevent the compiler from doing better.

## Takeaways

- **RVO (prvalue elision) is mandatory since C++17.** Returning a temporary directly is guaranteed not to copy, even for non-movable types.
- **NRVO (named return value optimization) is still optional, but it works in practice when a function has a single named local of the return type returned through every path.**
- **Don't `std::move` on return.** Looks like an optimization. It actually disables NRVO and forces a move where you would have had full elision (zero ops).
- **Don't return different named locals from different branches.** NRVO requires one stable local. If you have two, restructure or accept the move cost.
- **Returning by value is the modern default.** The decade-old "use an out-param for performance" advice is outdated. RVO/NRVO plus move semantics make value returns competitive with or faster than out-params.
- **Profile if you care.** Compilers are good but version-dependent. Verify NRVO actually fires on your compiler at your optimisation level. Bloomberg's wins came from measuring, not assuming.


The pattern is "trust the compiler, write the obvious thing." Most attempts to "help" the compiler return values faster make the result slower because they trigger the fallback move path instead of full elision. The one-liner that catches most cases: **`return x;` over `return std::move(x);`, every time.**
