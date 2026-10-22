# Manual playback controls

## Message buttons

The public OpenCode V2 plugin API does not document a slot for buttons inside individual conversation messages.
The installed `@opencode/plugin` package (2.1.2) also has no message slot in its `SlotMap` type.

CLI plugins can add UI controls at `session.composer.top`, above the conversation input.
This would support a nearby playback control, but not a button attached to each response.
It would require a CLI plugin entrypoint (`./tui`), which this package does not currently provide.

CLI plugins can also register custom fenced-code renderers with `markdown.registerCodeBlockRenderer`.
This offers a possible route to custom content within Markdown messages.
The documentation does not establish a supported message-action button API through these renderers.
Do not treat this route as confirmed without a working prototype.

These findings apply to the terminal interface. The documentation does not establish an equivalent extension API for web or desktop messages.

## Current implementation

Use `/tts-off` to stop automatic speech, then `/tts-play` to hear the latest assistant response in that conversation.
Playback uses the selected summary or full-response mode. The command does not change automatic speech settings.
The existing `/tts-repeat` command remains available.

## Sources

- [OpenCode V2 plugins: commands and sessions](https://opencode.ai/v2/docs/build/plugins)
- [OpenCode V2 CLI plugins: slots, Markdown renderers, and package entrypoints](https://opencode.ai/v2/docs/build/plugins/cli)
- Installed type definitions: `node_modules/@opencode/plugin/dist/tui/context.d.ts`
