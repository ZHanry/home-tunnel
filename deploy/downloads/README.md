# Windows release directory

`latest.json` is reserved for the Windows updater. Do not generate or ship it while official Windows distribution is suspended. The control center and existing clients treat a missing manifest as “updates unavailable”; server releases must never copy an `.exe` into this directory.
