# SPL BOT DOCUMENTATION (BETA1.3.0)

## Commands:

- **team-add**: adds a new team to the database.  
  **Syntax:** `:?team-add <ROLE_ID/@ROLE> <TEAM_EMOJI>`
- **team-delete**: deletes a team from the database.  
  **Syntax:** `:?team-delete <ROLE_ID/@ROLE>`
- **teams-view**: view all registered teams in the database.  
  **Syntax:** `:?teams-view`
- **team-set-emoji**: updates a registered team emoji.  
  **Syntax:** `:?team-set-emoji <ROLE_ID/@ROLE> <TEAM_EMOJI>`
- **appoint**: members with the `Administrator` permission can appoint other members to a team.  
  *Note: only players with the `Verified` role can be appointed.*  
  **Syntax:** `:?appoint <USER> <TEAM>`
- **sign**: managers can sign other free agents, and the bot sends a DM to the signed player.  
  *Note: only players with the `Verified` role can be signed.*  
  **Syntax:** `:?sign <USER>`
- **release**: managers can release players from their roster.  
  **Syntax:** `:?release <USER>`
- **demand**: players can release themselves from their current team.  
  **Syntax:** `:?demand`
- **promote**: managers can make one of their players an assistant manager.  
  **Syntax:** `:?promote <USER>`
- **demote**: managers can remove the assistant manager role from a player.  
  **Syntax:** `:?demote <USER>`
- **rosters**: view all teams with their number of players.  
  **Syntax:** `:?rosters`
- **manager-list**: view all teams’ managers.  
  **Syntax:** `:?manager-list`
- **disband**: removes every member from a team and marks them as free agents.  
  *Note: only members with the `Administrator` permission can run this.*  
  **Syntax:** `:?disband <TEAM>`
- **viewmembers**: view all members who have one or more roles.  
  **Syntax:** `:?viewmembers <ROLE(s)>`
- **record-stats**: record a played match’s stats and store them in the database.  
  *Used with a match message link that follows the league’s match template.*  
  **Syntax:** `:?record-stats <MESSAGE_URL>`
- **single-record**: manually add goals and assists for a single player in a specific league.  
  *Used when you want to record stats for one player without parsing a match message.*  
  **Syntax:** `:?single-record <MENTION/USER_ID/USERNAME> <GOALS> <ASSISTS> <LEAGUE>`
- **bulk-record**: loop over messages in a channel and record all unrecorded results  
  **Syntax:** `:?bulk-record <CHANNEL_URL>`
- **set-top-players**: used by admins to set the top players channel of a league
  **Syntax:** `:?set-top-players <RESULT_CHANNEL_URL> <TOP_PLAYERS_CHANNEL_URL>`
- **update-top-players**: used by admins to update the top players of all leagues
  **Syntax:** `:?update-top-players`