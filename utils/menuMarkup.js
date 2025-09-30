function buildMainMenu(user) {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: `✅ Registered as ${user?.username || "Guest"}`, callback_data: "registered" }],
        [{ text: "🎮 Play", callback_data: "Play" }],
        [
          { text: "💰 Check Balance", callback_data: "balance" },
          { text: "💳 Deposit", callback_data: "deposit" }
        ],
        [
          { text: "📞 Contact Support", callback_data: "support" },
         // { text: "📖 Instruction", web_app: { url: "https://frontend.bingoogame.com/instruction" } }
          { text: "📖 Instruction", callback_data: "open_instructions_menu" } 
        ],
        [{ text: "📨 Invite", callback_data: "invite" }]
      ]
    }
  };
}


function buildInstructionMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: "✅ Registration Guide", callback_data: "guide_registration" }],
        [{ text: "🎮 How To Play Guide", callback_data: "guide_howtoplay" }],
        [{ text: "💳 Deposit Guide", callback_data: "guide_deposit" }],
        [{ text: "💸 Withdrawal Guide", callback_data: "guide_withdrawal" }],
        // Back button to return to the main menu
        [{ text: "⬅️ Back to Main Menu", callback_data: "main_menu" }]
      ]
    }
  };
}

module.exports = { buildMainMenu, buildInstructionMenu }; // Ensure you export the new function

