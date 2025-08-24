function buildMainMenu(user) {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: `✅ Registered as ${user?.username || "Guest"}`, callback_data: "registered" }],
        [{ text: "🎮 Play Demo", callback_data: "playdemo" }],
        [
          { text: "💰 Check Balance", callback_data: "balance" },
          { text: "💳 Deposit", callback_data: "deposit" }
        ],
        [
          { text: "📞 Contact Support", callback_data: "support" },
          { text: "📖 Instruction", web_app: { url: "https://bossbingo.netlify.app/instruction" } }
        ],
        [{ text: "📨 Invite", callback_data: "invite" }]
      ]
    }
  };
}

module.exports = { buildMainMenu };
