// This file imports ALL commands and exports them

import check from "./utils/check.js";
import viewmembers from "./mod/viewmembers.js";
import recordStats from "./stats/recordStats.js";
import teamsView from "./teams/teams-view.js";
import teamAdd from "./teams/team-add.js";
import teamDelete from "./teams/team-delete.js";
import teamSetEmoji from "./teams/team-set-emoji.js";
import appoint from "./teams/appoint.js";
import sign from "./teams/sign.js";
import release from "./teams/release.js";
import demand from "./teams/demand.js";
import promote from "./teams/promote.js";
import demote from "./teams/demote.js";
import rosters from "./teams/rosters.js";
import managerList from "./teams/manager-list.js";
import disband from "./teams/disband.js";
import singleRecord from "./stats/singleRecord.js";
import bulkRecord from "./stats/bulkRecord.js";
import setTopPlayers from "./stats/setTopPlayers.js";
import updateTopPlayers from "./stats/updateTopPlayers.js";

// Store all commands in an array
const commandList = [
  check,
  viewmembers,
  recordStats,
  teamsView,
  teamAdd,
  teamDelete,
  teamSetEmoji,
  appoint,
  sign,
  release,
  demand,
  promote,
  demote,
  rosters,
  managerList,
  disband,
  singleRecord,
  bulkRecord,
  setTopPlayers,
  updateTopPlayers
];

// Function to convert commands to object (for fast lookup)
export function getCommandsObject() {
  const commands = {};
  commandList.forEach(cmd => {
    if (cmd && cmd.name) {
      commands[cmd.name.toLowerCase()] = cmd;
    }
  });
  return commands;
}

// Function to get JSON for Discord API
export function getCommandsJSON() {
  return commandList
    .filter(cmd => cmd?.data?.toJSON)
    .map(cmd => cmd.data.toJSON());
}

// Export the array too if needed
export { commandList };