const User = require("../Model/user");
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");

module.exports = function (bot) {
  // Command to start fund transfer
  bot.command("transfer_funds", async (ctx) => {
    const telegramId = ctx.from.id;

    try {
 // ✅ Rate limit: 1 request per second per user
           await userRateLimiter.consume(telegramId);
     
           // ✅ Rate limit: 200 requests per second globally
           await globalRateLimiter.consume("global");
      const user = await User.findOne({ telegramId });

      if (!user) {
        return ctx.reply("🚫 You must register first to transfer funds.");
      }

      // Initialize transfer flow
      await User.updateOne(
        { telegramId },
        { $set: { transferInProgress: { step: 1, recipient: null, amount: 0 } } }
      );

      return ctx.reply("🔢 Please enter the recipient's account number:");
    } catch (error) {
      if (error && error.msBeforeNext) {
        return ctx.reply("⚠️ Please wait a moment before trying again.");
      }
      console.error("❌ Error in /transfer_funds command:", error);
      return ctx.reply("🚫 An error occurred. Please try again later.");
    }
  });
};
