const User = require("../Model/user");
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");

// You should define this function or import it if it's already defined elsewhere.
// For example, if it's in a utils file.
async function clearAllFlows(telegramId) {
  await User.findOneAndUpdate({ telegramId }, {
    $set: {
      withdrawalInProgress: null,
      transferInProgress: null,
      registrationInProgress: null,
      usernameChangeInProgress: null,
      depositInProgress: null
    }
  });
}

module.exports = function (bot) {
  bot.command("deposit", async (ctx) => {
    const telegramId = ctx.from.id;

    try {
      // ✅ Apply rate limiting
      await Promise.all([
        userRateLimiter.consume(telegramId),
        globalRateLimiter.consume("global"),
      ]);

      const user = await User.findOne({ telegramId });

      if (!user) {
        return ctx.reply("🚫 You must register first to make a deposit. Please click below to register:", {
          reply_markup: {
            inline_keyboard: [[{ text: "🔐 Register", callback_data: "register" }]]
          }
        });
      }
      // ✅ Clear all other in-progress flows to prevent conflicts.
      await clearAllFlows(telegramId);

      // ✅ CRITICAL CHANGE: Instead of entering a scene, we now set the state in the database
      // The first step is now AwaitingAmount
      await User.updateOne({ telegramId }, { $set: { "depositInProgress.step": "AwaitingAmount" } });

      return ctx.reply("💰 ለማስገባት የሚፈልጉትን መጠን ያስገቡ: (ለመውጣት /cancel )");
    } catch (err) {
      if (err && err.msBeforeNext) {
        return ctx.reply("⚠️ Please wait a second before trying again.");
      }
      console.error("❌ Error in /deposit command:", err.message);
      return ctx.reply("🚫 An error occurred. Please try again.");
    }
  });
};
