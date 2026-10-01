# programs/draw

The Anchor program is milestone M4. It is not part of M0 or M1.

Planned accounts: `Config`, `PotVault`, `Draw`.

Planned instructions: `initialize`, `open_draw`, `commit_entrants`, `request_randomness`, `settle_draw`, `claim`, `admin_update`.

Winner index is `randomness mod entrant_count`. The program must verify a Merkle proof against the root committed before randomness is requested.

Do not add program code here until M4. No private keys belong in this repo.
