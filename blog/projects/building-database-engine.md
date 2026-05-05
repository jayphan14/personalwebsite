I built [database_engine](https://github.com/jayphan14/database_engine) to learn how databases actually work. I have taken a database class, read books and PostgreSQL source code but I still think that's there are learning values in building this myself (also with the help of an agent, another topic I will talk about another day).

It is a disk-backed storage engine in C++17 with a typed query language on top. The full end to end SQL pipeline is shipped now: pages, buffer pool, heap file, tuple codec, persistent catalog, parser, analyzer, planner, executor. It shows me more or less the architechture and key challenges of building a DBMS.

My aha moment is cold-restart demo. Insert rows. Close the file. Re-open it with a fresh BufferPool and a fresh Catalog. The catalog rebuilds itself from two hardcoded system pages, and the same SELECT runs again over the same data. Until that demo worked, I did not believe I had built a database. I had built a fancy in-memory cache.

## The architecture

The engine is layered. Each layer talks to the one below it.

![database_engine architecture: SQL pipeline (Parser, Analyzer, Planner, Executor) on top of a storage stack (Catalog, Tuple codec, HeapFile, SlottedPage, BufferPool, DiskManager) backed by a single OS file](assets/graphs/database-pipeline.svg)

Top of the stack is the SQL pipeline. Four stages, in order:

1. **Parser**. Hand-written recursive descent. Tokenises a single SELECT into a string-based AST. Supports `SELECT (* | cols) FROM table {JOIN table ON col = col} [WHERE col op literal]`.
2. **Analyzer**. Walks the AST against the catalog. Replaces every name with a `(table_index, column_index)` pair. Attaches types. Rejects type mismatches and ambiguous bare columns.
3. **Planner**. Lowers the bound AST into a tree of operators. 1:1 today: outer `SeqScan`, then a stack of `NestedLoopJoin`s, then an optional `Filter` on top. No optimiser yet.
4. **Executor**. Drives the operator tree Volcano-style with `open / next / close`. Applies the SELECT projection. Returns rows.

Below the SQL surface is the storage stack:

5. **Catalog**. Persistent table schemas. Stored as two system heap files: `__tables` at page 0, `__columns` at page 1. On startup it rebuilds itself from those known pages. No manifest, no config.
6. **Tuple codec**. Serialise and deserialise typed tuples to and from raw bytes. Fixed-width for `Int32` / `Int64` / `Bool`, length-prefixed for `Text`.
7. **HeapFile**. An unordered collection of tuples spread over a chain of slotted pages, linked by `next_page_id`.
8. **SlottedPage**. Byte-level page format. Header, slot directory growing down, records growing up, free space in the middle.
9. **BufferPool**. LRU page cache with pin and dirty bits. A `PageGuard` RAII type makes leaks hard.
10. **DiskManager**. Raw page I/O against one file. Page N at byte offset `N * 4096`.

## The query pipeline, end to end

`SELECT name FROM users WHERE age > 18` goes through four stages. One IR per stage. Each stage takes the previous IR and produces something more concrete.

![query processing pipeline: SQL string to SelectQuery (Parser) to BoundSelect (Analyzer) to PlanNode tree (Planner) to ExecResult (Executor)](assets/graphs/database-query-pipeline.svg)

I think of each stage as one short sentence. The parser turns characters into a tree of strings. The analyzer turns strings into integers, against the catalog. The planner turns the tree into operators. The executor drives the operators.

The thing I did not appreciate before building this: the parser is dumb on purpose. It does not know what tables exist. `users` is just a string until the analyzer gets to it. By the time the planner runs, every reference is already a numeric index and every expression already has a type, so the planner and executor never have to think about the catalog. Most of the type errors I had to debug, I caught in the analyzer. That is by design.

## The storage layer, RAM and disk

All durable state lives in one OS file. Everything above DiskManager is either bytes in flight or in-memory metadata.

![storage layout: BufferPool frames in RAM mirroring 4 KiB pages on disk; one slotted page expanded to show header, slot directory, free space, and tuple bytes](assets/graphs/database-storage-layout.svg)

The trick that ties RAM and disk together is the BufferPool. The rest of the engine never asks "is this page on disk or in memory?" It borrows a `PageGuard` for a page id, and the BufferPool quietly fetches it on miss. Pin counts protect a page from eviction while someone is reading it. The dirty bit tells the pool to write it back before evicting.

A SlottedPage is the format inside one 4 KiB block. Header at the top. Slot directory grows down from there. Tuple bytes grow up from the bottom. Inserts take from the free space in the middle. Deletes leave a tombstone in the slot directory, which a later insert can reuse. The slot id stays stable across compaction. That is the point. A `RID` of `(page_id, slot_id)` keeps pointing at the same logical row even after the page rearranges itself.

A HeapFile is just a chain of these pages, linked by `next_page_id` in the header. The Catalog itself is two hardcoded HeapFiles at pages 0 and 1. That is what makes cold-open work without any external manifest. Open the file. Walk pages 0 and 1. Rebuild every `TableInfo` in memory.

## How I built each layer

The order I built them in, bottom up, which is also the order I would recommend:

**DiskManager**. Open a file. Read and write fixed-size pages at known offsets. Surprisingly little code. Just `pread` and `pwrite` with a page size constant. Files only grow. Allocation is "next free page id".

**BufferPool**. A hash map from page id to frame, plus an LRU list. On miss, evict the least recently used unpinned frame, write it back if dirty, then read the new page through DiskManager. The `PageGuard` RAII handle does the pinning, unpinning, and dirty marking automatically. I want to call out that handle. It is the single most important abstraction in the storage stack. Without it, every other layer would be full of "remember to unpin" boilerplate, and one early-return on an error path would corrupt everything.

**SlottedPage**. Header at the top, slot directory growing down, records growing up. Inserts take from the free space in the middle. Deletes leave a tombstone. I built compaction last, after I had a few bugs with shrinking pages and figured out I needed it.

**HeapFile**. A chain of slotted pages linked by `next_page_id`. Insert finds the first page with enough free space. Scan walks the chain. Built on top of BufferPool, so the file has a stable in-memory view.

**Tuple codec**. Write the type tag, then the bytes. Read in the same order. The schema tells you what types to expect. Length-prefixed for variable-length fields.

**Catalog**. The system tables. Stored as two heap files at hardcoded page ids: `__tables` at page 0, `__columns` at page 1. On boot, walk those two heap files and rebuild every user table's `TableInfo` in memory. No manifest needed. The file is self-describing. Getting this part working is what unlocked the cold-restart demo.

**Parser**. Recursive descent. Each non-terminal is a function. `parseSelectStatement` calls `parseColumnList`, then `parseFromClause`, then optional `parseJoinClause`, then optional `parseWhereClause`. Operator precedence is the trickiest part of a parser in general, but the WHERE grammar is tiny so far, so it has not bitten me yet.

**Analyzer**. Walks the AST. For each table reference, look up the schema. For each column reference, find the index and type. Type-check binary expressions and the WHERE predicate. The output is a `BoundSelect` with the same shape as the parser AST, but with strings replaced by integer indices and every node carrying a `result_type`.

**Planner**. Takes the `BoundSelect` and builds an operator tree. Today the lowering is fixed: outer `SeqScan`, a stack of `NestedLoopJoin`s for the JOIN list, optional `Filter` on top. I added the planner as a separate step on purpose, even though it is just one shape today. The point is the seam. When alternative operators show up (hash join, index scan, predicate pushdown), the planner is where the optimiser will plug in.

**Executor**. Walks the operator tree using the Volcano model. Every node implements `open() / next() / close()`. `SeqScan` pulls tuples one at a time from a HeapFile and decodes them. `NestedLoopJoin` materialises the right child once on `open()`, then nested-loops over (left × right) and emits combined rows where the ON predicate holds. `Filter` pulls from its child until the predicate is true. Once the tree is drained, the executor applies the SELECT projection and returns the rows as an `ExecResult`.

## What's next

The roadmap, roughly in priority order:

1. **DML at the SQL surface**. INSERT, UPDATE, DELETE. The storage stack already supports them. Right now rows are inserted by hand via `HeapFile::insert` + `TupleCodec::encode`, which is fine for the demo but not the point. Wiring them into the parser and executor is the next obvious move.
2. **More of SQL**. ORDER BY, LIMIT, aggregates, expressions in the SELECT list, plus table aliases so the same physical table can appear twice in one query.
3. **Alternative operators and a real optimiser**. HashJoin, IndexScan, predicate pushdown. The planner is the seam. These are new `PlanNode` subclasses plus rewrite passes that pick between them.
4. **EXPLAIN**. Every operator already has a `describe()` method, so this is mostly plumbing once it is worth wiring up.
5. **Indexes**. A B+tree from column value to RID. Lookups instead of full scans. The first time `IndexScan` would actually beat `SeqScan`.
6. **Transactions, recovery, concurrency control**. Write-ahead log, undo and redo, isolation levels, locking or MVCC. Each of these is a project on its own.

## What I take away

Two big lessons from building bottom up.

Storage really is the foundation. Everything else (catalog, types, queries, plans, execution) sits on top of "pages on disk, cached in memory." Once that layer was solid, the rest of the system had a stable surface to build on. Starting at DiskManager and working upward, instead of starting at Parser, was the single best call I made on this project.

Persistence is the line between "running program with structured data" and "database." The cold-restart test is the simplest way to verify you have actually built one. Until you have closed the file, re-opened it, and read your data back through the catalog, you do not have a database. You have a fancy in-memory cache.

If you have used SQL forever without thinking about how it works, build a storage engine. It will change how you read EXPLAIN.
