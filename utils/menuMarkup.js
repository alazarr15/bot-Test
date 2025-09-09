function buildMainMenu(user) {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: `✅ Registered as ${user?.username || "Guest"}`, callback_data: "registered" }],
        [{ text: "🎮 Play", callback_data: "play" }],
        [
          { text: "💰 Check Balance", callback_data: "balance" },
          { text: "💳 Deposit", callback_data: "deposit" }
        ],
        [
          { text: "📞 Contact Support", callback_data: "support" },
          { text: "📖 Instruction", web_app: { url: "https://frontend.bingoogame.com/instruction" } }
        ],
        [{ text: "📨 Invite", callback_data: "invite" }]
      ]
    }
  };
}

module.exports = { buildMainMenu };
