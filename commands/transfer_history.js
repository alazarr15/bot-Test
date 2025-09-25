const User = require("../Model/user");
const Transfer = require("../Model/transfer");
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");

module.exports = function (bot) {
  bot.command("transfer_history", async (ctx) => {
    const telegramId = ctx.from.id;

    try {
      // Rate limiting
      await Promise.all([
        userRateLimiter.consume(telegramId),
        globalRateLimiter.consume("global")
      ]);

      // User check
     const user = await User.findOne({ telegramId });

// Check if the user exists and if they have a phone number
if (!user || !user.phoneNumber) {
  // If the user doesn't exist OR they don't have a phone number,
  // they are not fully registered.
  return ctx.reply("🚫 You must register first to check your balance. Please click below to register:", {
    reply_markup: {
      inline_keyboard: [[{ text: "🔐 Register", callback_data: "register" }]]
    }
  });
}

      // Fetch last 5 transfers
      const HISTORY_LIMIT = 5;
      const history = await Transfer.find({
        $or: [{ senderTelegramId: telegramId }, { recipientTelegramId: telegramId }]
      })
        .sort({ date: -1 })
        .limit(HISTORY_LIMIT);

      if (history.length === 0) {
        return ctx.reply("ℹ️ You have no transfer history yet.");
      }

      // Build message
      let msg = `📜 Your last ${HISTORY_LIMIT} transfers:\n\n`;
      history.forEach((t, i) => {
        const type = t.senderTelegramId === telegramId ? "Sent" : "Received";
        const counterparty = t.senderTelegramId === telegramId ? t.recipientPhone : t.senderPhone;
        const dateStr = t.date.toLocaleString();
        msg += `${i + 1}. ${type} ${t.amount} Birr ${type === "Sent" ? "to" : "from"} ${counterparty} on ${dateStr}\n`;
      });

      msg += `\nℹ️ To see your full transfer history, please visit your dashboard.`;

      await ctx.reply(msg);
    } catch (err) {
      if (err && err.msBeforeNext) {
        return ctx.reply("⏳ Too many requests. Please wait a moment.");
      }
      console.error("❌ Error in /transfer_history:", err);
      return ctx.reply("🚫 Could not fetch transfer history. Please try again later.");
    }
  });
};
