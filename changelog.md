# SPL BOT CHANGELOG:
## beta1.3.0:
- new `set-top-players` command
- new `update-top-players` command
## beta1.2.0:
- `recordstats` command has been renamed into `record-stats`
- `record-stats` reacts with **"✅"** on the recorded result, and refuses to record the message that is reacted with **"✅"** by the bot (prevent duplicate recording for a single result)
- A new `single-record` command to manually add goals and assists for a single player in a specific league
- A new `bulk-record` command to loop over messages in a channel and record all unrecorded results
## beta1.1.0:
- fixed the `rosters` command
- huge rework for the `recordstats` command
- other major bug fixes
## beta1.0.0:
- initial release