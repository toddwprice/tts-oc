# TTS-OC

TTS-OC is an [OpenCode](https://opencode.ai) plugin that reads assistant responses aloud.

- Speak a short summary or the full response.
- Use Edge TTS by default, or use a system speech tool.
- Add on-demand speech controls above the terminal composer.
- Cache generated audio so later playback does not repeat summary generation or TTS.

## Requirements

- OpenCode V2.
- Node.js 22 or newer.
- Python 3 for the default Edge TTS backend. The plugin installs Edge TTS in a managed virtual environment.
- An audio player: `afplay` on macOS, or `ffplay` or `mpg123` on Linux.

You can use the macOS `say` command or Linux `spd-say` or `espeak` instead. This backend does not need Python or Edge TTS.

## Install

### Install from this GitHub fork

1. Clone this repository.

   ```sh
   git clone https://github.com/toddwprice/tts-oc.git
   cd tts-oc
   npm install
   npm run build
   ```

2. Add the built plugin to `~/.config/opencode/cli.json`.

   Keep your existing settings. Add this object to the `plugins` array:

   ```jsonc
   {
     "plugins": [
        {
          "package": "/absolute/path/to/tts-oc",
          "options": {
            "summaryProvider": "ganglia",
            "summaryModel": "deepseek-v4-flash"
          }
        }
      ]
   }
   ```

Change the path to the repository directory. The model options are optional. Remove them to summarize with the model that produced the response.

3. Restart OpenCode. The CLI loads controls from the plugin package's `./tui` entrypoint. It prepares Edge TTS when you first use a control.

### Change the code and run it locally

Clone the repository, install dependencies, and build it with the commands above. OpenCode loads the built `dist` directory. Rebuild after each code change.

## Use

The terminal UI shows two controls above the chat input.

| Control | Action |
| --- | --- |
| Speak Response | Create and play audio for the latest assistant response. |
| Speak Summary | Create and play a short spoken summary of the latest assistant response. |

Press the same control again to replay its cached audio. Full responses and summaries use separate cache files.
Use `Ctrl+Shift+R` for Speak Response and `Ctrl+Shift+S` for Speak Summary. The command palette also lists both actions.

There is no automatic speech mode. Each action starts only when you use its control, shortcut, or palette command.

## Configure

TTS-OC stores its settings and runtime files in `~/.config/opencode/plugins/tts-oc/`.
The settings file is `config.json`:

```jsonc
{
  "debug": false,
  "backend": "edge_tts",
  "voice": "en-US-AvaNeural",
  "summaryLength": "2 sentences",
  "cacheRetentionDays": 3,
  "edge_tts": {
    "rate": "+25%",
    "volume": "+0%"
  }
}
```

If you used an earlier version, TTS-OC moves its old settings file to `config.json` when the new file does not exist.
It preserves existing cache and runtime files.

TTS-OC also stores its Edge TTS environment, speech queue, cached audio, and log in this folder.
At CLI startup, it moves existing TTS-OC runtime files to this folder when the new destination does not exist.
If a destination already exists, TTS-OC preserves the old item in the `legacy/` folder inside this directory.

Set `cacheRetentionDays` to change the audio cache lifetime. The default is three days. TTS-OC removes expired cache files when the CLI loads and before a playback.

Use `backend: "say"` to use the system speech tool instead of Edge TTS. Set `voice` to override the default voice. You can also set a custom Edge TTS command:

```jsonc
{
  "edge_tts": {
    "command": ["python3", "-m", "edge_tts"]
  }
}
```

### Summary model

Set `summaryProvider` and `summaryModel` in the plugin's `options` in `cli.json`:

```jsonc
{
  "plugins": [
    {
      "package": "/absolute/path/to/tts-oc",
      "options": {
        "summaryProvider": "ganglia",
        "summaryModel": "deepseek-v4-flash"
      }
    }
  ]
}
```

The plugin config file values are used if the plugin options do not set them. If a value is missing, the plugin uses the assistant's model. If the configured model fails, the plugin tries the assistant's model. If both models fail, it speaks a short text extract.

### Speech queue

Speech requests use a local queue in `~/.config/opencode/plugins/tts-oc/queue`. OpenCode tabs and processes on the same computer use this queue. Each playback waits for earlier speech to finish. The queue does not coordinate across computers.

## Troubleshoot

- **No speech starts:** Check that OpenCode loaded the plugin and that your selected speech backend is installed.
- **Edge TTS does not start:** Install Python 3. Check that an audio player is available.
- **The wrong summary model runs:** Check `summaryProvider` and `summaryModel` under this plugin's `options` in `cli.json`.
- **A prior playback blocks speech:** Check for stale queue files in the plugin queue directory. Remove them only after you confirm no OpenCode process is speaking.
- **Need more detail:** Set `debug` to `true` in the plugin config file. Read `~/.config/opencode/plugins/tts-oc/tts-oc.log`.

## Develop

```sh
npm install
npm run typecheck
npm test
npm run build
```

`npm test` runs the test suite. Tests use Node's built-in test runner.

## Contribute

Contributions are welcome. You do not need permission to open a pull request.

1. Open an issue to report a bug or propose a large change. For a small fix, you can open a pull request directly.
2. Fork this repository and create a branch for your change.
3. Make a focused change. Add or update tests when behavior changes.
4. Run `npm run typecheck`, `npm test`, and `npm run build`.
5. Open a pull request against `toddwprice/tts-oc`. Describe the problem, the change, and the checks you ran.

Small fixes, documentation updates, bug reports, and questions are welcome. If you are not sure whether a change fits, open an issue or draft pull request and explain your idea.

## Project history and license

TTS-OC is a community fork of [opencode-tts by Stefano Chiodino](https://github.com/StefanoChiodino/opencode-tts). This project uses the MIT license. See the upstream repository for its license terms.
