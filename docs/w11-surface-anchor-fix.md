# W11 surface anchor fix

The week mutation flow keeps two dates distinct:

- week anchor: selects the persisted week for move/remove mutations;
- surface anchor: the user's current local day used to rebuild the visible week.

Never refresh `week_read_contract_v2` with `weekStart` after a mutation, otherwise expired soft opportunities from earlier in the week can become visible again.
