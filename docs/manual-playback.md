# Manual playback controls

## Terminal controls

The OpenCode V2 CLI plugin API provides the `session.composer.top` slot. It places controls above the terminal composer.
The CLI loads these controls through the plugin package's `./tui` entrypoint.

Both controls use the latest assistant response in the active session. They do not create controls beside each message.
The full response and summary have separate cached audio files.

The control actions also have keyboard shortcuts:

- `Ctrl+Shift+R`: Speak Response.
- `Ctrl+Shift+S`: Speak Summary.

## Cache

The plugin stores audio in `~/.config/opencode/plugins/tts-oc/audio-cache/`.
It removes files older than `cacheRetentionDays` from `config.json`.
The default retention period is three days.

Cleanup runs when the CLI plugin loads, and before each playback.
The plugin does not schedule cleanup while OpenCode is closed.

## Platform scope

These controls apply to the OpenCode terminal UI. The plugin API does not document the same controls for web or desktop.
Mouse events depend on terminal support. Keyboard shortcuts and the command palette provide alternate ways to start playback.

## Sources

- [OpenCode V2 CLI plugins](https://opencode.ai/v2/docs/build/plugins/cli)
- [OpenCode V2 CLI plugin loading](https://opencode.ai/v2/docs/cli/plugins)
- [OpenTUI interaction](https://opentui.com/docs/core-concepts/interaction)
