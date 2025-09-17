const botCommands = [
  { command: "start", description: "Start the bot" },
  { command: "Play", description: "Start playing game" },
  { command: "register", description: "Register for an account" },
  { command: "balance", description: "Check account balance" },
  { command: "deposit", description: "Deposit funds" },
  { command: "withdraw", description: "withdraw funds" },
  { command: "invite", description: "Invite friends" },
  { command: "transfer_funds", description: "Transfer funds" },
  { command: "change_username", description: "Change your username" },
  { command: "transfer_history", description: "see my last 10 transfers" },
  { command: "resetme", description: "reset my account" }

];

module.exports = { botCommands };
