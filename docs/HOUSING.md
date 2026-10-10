# Housing and daily life

The initial working residence is the gameplay-scaled Glover Court Garden Flat
in Ikoyi. A resident can purchase it permanently or rent it for 30 days using
fictional game naira. PostgreSQL locks the listing while tenure is acquired, so
two residents cannot win the same home concurrently.

Owners can:

- enter the saved interior;
- buy furniture from the existing shop and place it on the room grid;
- retain furniture positions across reconnection;
- cook, clean, and sleep (sleeping requires a placed bed);
- invite another resident by public player name.

Guests can enter and use daily-life interactions but cannot move furniture or
invite others. Access checks run on every server request; hiding interface
buttons is not treated as permission enforcement.

Hunger, energy, and cleanliness are optional routine indicators. They currently
change only through explicit home actions, avoiding punitive offline decay.
Utilities, recurring bills, storage, roommates, and editable furniture rotation
remain scheduled expansions.
