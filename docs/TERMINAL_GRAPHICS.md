# Terminal graphics

wmux renders terminal-native images through Ghostty's Kitty graphics storage and Canvas 2D compositor.
This keeps image pixels, placement, z-index ordering, virtual placeholders, and scrollback movement inside the terminal renderer.
Product chrome remains outside the terminal canvas.

## Supported Kitty paths

Direct RGB and RGBA transfers pass through without modification.
PNG transfers are decoded in the browser and normalized to direct RGBA because the pinned Ghostty renderer exposes only raw pixel formats to its compositor.
Chunked transfers are reassembled when normalization is necessary and emitted in Kitty-compliant 4096-character Base64 chunks.

File, temporary-file, and POSIX shared-memory transfers use a browser-authenticated pane-scoped endpoint.
The endpoint reads from the immutable machine snapshot owned by the live pane and never accepts a client-selected machine.
Reads are limited to 32 MiB, honor the protocol's byte offset and size, reject non-regular files and symbolic links, and use the pane's existing SSH control connection for remote hosts.
Temporary files are deleted only when their absolute path is under a known temporary directory and contains `tty-graphics-protocol`.
POSIX shared-memory objects are read from `/dev/shm` and unlinked after a successful read.
Windows named shared memory is not supported.

Ghostty owns image IDs, placements, deletes, queries, signed z-index composition, Unicode virtual placeholders, and scrollback-relative placement.
wmux does not duplicate those semantics in a DOM image overlay.

## Unsupported protocols

Sixel and iTerm2 inline image sequences are recognized and removed from terminal text.
The pane displays a visible `[GRAPHICS WARN]` diagnostic that directs the user to Kitty graphics or `wmux-media`.

Sixel was evaluated against the existing overlay architecture.
Correct support requires a bounded raster decoder, palette and transparency semantics, repeat/raster controls, terminal response behavior, and damage integration that the current renderer does not expose.
iTerm2 inline images require a separate metadata, sizing, and cursor-placement model and do not provide Kitty's persistent image and placement identifiers.
Silently approximating either protocol would produce misleading placement and lifecycle behavior, so both remain explicitly unsupported.

Kitty animation frames are also not implemented.
Applications should use static Kitty images or the browser media shelf for animated content.

## Verification

The terminal graphics corpus covers direct pass-through, chunk assembly, PNG normalization, file and shared-memory controls, signed z-index preservation, virtual placements, scrollback retention, and visible unsupported-protocol diagnostics.
The native Ghostty headless test validates retained pixels and placement metadata after the image has scrolled outside the viewport.
