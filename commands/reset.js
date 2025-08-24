const User = require("../Model/user");
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");

module.exports = function (bot) {
  bot.command("resetme", async (ctx) => {
    const telegramId = ctx.from.id;

    try {
      // ✅ Rate limiting
      await userRateLimiter.consume(telegramId);
      await globalRateLimiter.consume("global");

      // ✅ Attempt user deletion
      const result = await User.deleteOne({ telegramId });

      if (result.deletedCount === 1) {
        return ctx.reply("🗑️ Your registration has been reset. You can now use /register again.");
      } else {
        return ctx.reply("⚠️ No user found to reset. You’re already unregistered.");
      }
    } catch (err) {
      if (err && err.msBeforeNext) {
        return ctx.reply("⚠️ Please wait before trying again.");
      }

      console.error("❌ Error in /resetme:", err.message);
      return ctx.reply("🚫 An error occurred. Please try again.");
    }
  });
};
