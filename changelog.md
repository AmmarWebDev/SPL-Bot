# SPL DATABASE BOT CHANGELOG:
## v1.0.0:
- The bot is renamed from **SPL Bot** into **SPL Databse**
- The recording of stats is now stable and almost problem-free
- Major bug fixes
## beta1.3.0:
- New `set-top-players` command
- New `update-top-players` command
## beta1.2.0:
- `recordstats` command has been renamed into `record-stats`
- `record-stats` reacts with **"✅"** on the recorded result, and refuses to record the message that is reacted with **"✅"** by the bot (prevent duplicate recording for a single result)
- A new `single-record` command to manually add goals and assists for a single player in a specific league
- A new `bulk-record` command to loop over messages in a channel and record all unrecorded results
## beta1.1.0:
- Fixed the `rosters` command
- Huge rework for the `recordstats` command
- Other major bug fixes
## beta1.0.0:
- Initial release