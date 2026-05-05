I built [CPP-Game-Engine](https://github.com/jayphan14/CPP-Game-Engine) as a class project. The goal was a small C++ library that other people could write 2D games on top of. I would say its my first into to building software for other software enigneers.

The fundamental loop is simple. Read input, update the world, draw the world. Repeat sixty times a second. Everything else is optimization, abstraction, or features piled on top.

## The architecture

Three core pieces:

1. **Engine**: owns the main loop. Tick, update, draw, repeat.
2. **Display**: turns world state into pixels.
3. **Character**: anything that exists in the world and has behaviour. Players, enemies, projectiles, terrain.

![2D game engine architecture: Engine drives Display + Input + Characters; Characters split into Rectangle and BitMap; each character holds a Movement strategy](assets/graphs/game-engine-arch.svg)

Characters have **movement strategies** plugged into them: user input, straight line, bounce off, pass through, hide and unhide. This is the strategy pattern. Instead of putting "if player, do X; if enemy, do Y" inside Character, each character holds a Movement pointer and asks it for its next position. Adding a new movement type is one new class.

On top of Characters there are higher-level systems. A **Battle** system decides what happens when two characters collide. A **Relationship** system tracks who cares about whom (which becomes who-wants-to-fight-whom).

## How to build it, in order

The order I built things in, which is also the order I'd recommend:

1. **Display first.** Get something on screen. Even just a coloured square. The feedback loop when you can see what your code is doing is so much better than reasoning blindly.
2. **The game loop.** Read input, update everything, draw everything. Don't worry about delta-time or fixed timesteps yet. Just hit a target framerate with sleeps.
3. **Character base class.** Position, size, draw method. Nothing fancy.
4. **Concrete characters.** RectangleCharacter (a coloured box) and BitMapCharacter (loads an image). Subclasses, not config flags. You'll want completely different draw paths.
5. **Movement strategies.** UserInputMovement (WASD) first because you want a player. Then StraightLine for moving enemies. Then BounceOff for projectiles. Strategy pattern lets you mix and match without modifying Character.
6. **Collisions and Battle.** Now characters can move and intersect. Add a rule for what happens when they touch.
7. **Relationships.** Optional but fun. Characters get a team or rivalry attribute, which changes who hits whom in Battle.

## What I learned

- The strategy pattern earns its keep when you have N orthogonal behaviours on M types of objects. Without it, Character grows into a god class very fast.
- Inheritance for "kinds of thing" (RectangleCharacter, BitMapCharacter), composition for "behaviours" (Movement). Mixing the two axes is the recipe for tangled code.
- Almost every bug I hit was in the loop, not the rendering. Frame timing, double-counting input, mutating the character list while iterating it. Get the loop right first.
- Don't build your own renderer first time. Use SDL or even a terminal grid. The point of the project is the systems, not pixel buffers.

The repo is small and educational. Read it for the pattern, not for production-grade code. Building it was the first time I felt I understood why game engines are organised the way they are.
