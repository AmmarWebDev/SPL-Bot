# SPL BOT DOCUMENTATION (BETA1.1.0)

## Commands:

- **team-add**: adds a new team to the database. syntax `:?team-add <ROLE_ID/@ROLE> <TEAM_EMOJI>`
- **team-delete**: deletes a team to the database. syntax `:?team-delete <ROLE_ID/@ROLE>`
- **teams-view**: view all registered teams in the database. syntax `:?teams-view`
- **team-set-emoji**: updates a registered team emoji. syntax `:?team-set-emoji <ROLE_ID/@ROLE> <TEAM_EMOJI>`
- **appoint**: members with the `Administrator` permission can appoint other members a team. Note: only players with `Verified` role can be appointed. syntax `:?appoint <USER> <TEAM>`
- **sign**: managers can sign other free agents, and the bot sends a message to signed player on DMs. Note: only players with `Verified` role can be signed. syntax `:?sign <USER>`
- **release**: manager can release his players from his roster. syntax `:?release <USER>`
- **demand**: player can release himself from his current team. syntax `:?demand`
- **promote**: manager can make one of his players an assistant manager. syntax `:?promote <USER>`
- **demote**: manager can clear assistant manager from one of his players. syntax `:?demote <USER>`
- **rosters**: view all teams with their players' number. syntax `:?rosters`
- **manager-list**: view all teams' managers. syntax `:?manager-list`
- **disband**: removes every member from team ang gives them free agent (Note: only members with `Administrator` permission can run this). syntax `:?disband <TEAM>`
- **viewmembers**: view all member that has one role or more. syntax `:?viewmembers <ROLE\s>`
- **recordstats**: record a played match stats and store it in the database. syntax `:?recordstats <MESSAGE_URL>`
