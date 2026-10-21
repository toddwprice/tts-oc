# Talk to Me for OpenCode

Talk to Me is an [OpenCode](https://opencode.ai) plugin that reads assistant responses aloud.

- Speak a short summary or the full response.
- Use Edge TTS by default, or use a system speech tool.
- Queue speech across OpenCode tabs and processes that share this computer.
- Control speech with slash commands.

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
   git clone https://github.com/toddwprice/talk-to-me-oc.git
   cd talk-to-me-oc
   npm install
   npm run build
   ```

2. Add the built plugin to `~/.config/opencode/opencode.jsonc`.

   Keep your existing settings. Add this object to the `plugins` array:

   ```jsonc
   {
     "plugins": [
       {
         "package": "/absolute/path/to/talk-to-me-oc/dist",
         "options": {
           "summaryProvider": "ganglia",
           "summaryModel": "deepseek-v4-flash"
         }
       }
     ]
   }
   ```

   Change the path to the directory where you cloned the repository. The model options are optional. Remove them to summarize with the model that produced the response.

3. Restart OpenCode. The plugin installs Edge TTS the first time it speaks.

### Change the code and run it locally

Clone the repository, install dependencies, and build it with the commands above. OpenCode loads the built `dist` directory. Rebuild after each code change.

## Use

Summary mode starts enabled. It speaks a short summary after each response.

| Command | Action |
| --- | --- |
| `/tts-mode-summary` | Speak a summary of each response. |
| `/tts-mode-full` | Speak the complete response. |
| `/tts-on` | Enable automatic speech. |
| `/tts-off` | Disable automatic speech. |
| `/tts-speak <text>` | Speak the text now. |
| `/tts-repeat` | Speak the latest response again. |

Mode and enabled state persist across sessions in the plugin config file.

## Configure

Plugin settings live in `~/.config/opencode/plugins/opencode-tts.jsonc`:

```jsonc
{
  "enabled": true,
  "mode": "summary",
  "debug": false,
  "backend": "edge_tts",
  "voice": "en-US-AvaNeural",
  "summaryLength": "2 sentences",
  "edge_tts": {
    "rate": "+25%",
    "volume": "+0%"
  }
}
```

Use `backend: "say"` to use the system speech tool instead of Edge TTS. Set `voice` to override the default voice. You can also set a custom Edge TTS command:

```jsonc
{
  "edge_tts": {
    "command": ["python3", "-m", "edge_tts"]
  }
}
```

### Summary model

Set `summaryProvider` and `summaryModel` in the plugin's `options` in `opencode.jsonc`:

```jsonc
{
  "plugins": [
    {
      "package": "/absolute/path/to/talk-to-me-oc/dist",
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

Speech requests use a local queue in `~/.config/opencode/tts-queue`. OpenCode tabs and processes on the same computer use this queue. Each response waits for earlier speech to finish. The queue does not coordinate across computers.

## Troubleshoot

- **No speech starts:** Check that OpenCode loaded the plugin and that your selected speech backend is installed.
- **Edge TTS does not start:** Install Python 3. Check that an audio player is available.
- **The wrong summary model runs:** Check `summaryProvider` and `summaryModel` under this plugin's `options` in `opencode.jsonc`.
- **Speech does not start after a process closes:** Remove stale queue files only after you confirm no OpenCode process is speaking. The plugin also clears queue requests from stopped processes.
- **Need more detail:** Set `debug` to `true` in the plugin config file. Read `~/.config/opencode/logs/opencode-tts.log`.

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
5. Open a pull request against `toddwprice/talk-to-me-oc`. Describe the problem, the change, and the checks you ran.

Small fixes, documentation updates, bug reports, and questions are welcome. If you are not sure whether a change fits, open an issue or draft pull request and explain your idea.

## Project history and license

Talk to Me is a community fork of [opencode-tts by Stefano Chiodino](https://github.com/StefanoChiodino/opencode-tts). This project uses the MIT license. See the upstream repository for its license terms.
