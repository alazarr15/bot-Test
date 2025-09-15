const User = require("../Model/user");
const { usernameChangeInProgress } = require("../handlers/state/usernameChangeState");
const { buildMainMenu } = require("../utils/menuMarkup");
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");

module.exports = function (bot) {
  // Command to start username change
  bot.command("change_username", async (ctx) => {
    const telegramId = ctx.from.id;

    try {
      // ✅ Rate limit: 1 request per second per user
      await userRateLimiter.consume(telegramId);

      // ✅ Rate limit: 200 requests per second globally
      await globalRateLimiter.consume("global");

      const user = await User.findOne({ telegramId });
      if (!user) {
        return ctx.reply("🚫 You must register first to change your username.");
      }

      if (usernameChangeInProgress.has(telegramId)) {
        return ctx.reply("⚠️ You already have a username change in progress. Please type your new username or type /cancel to abort.");
      }

      usernameChangeInProgress.set(telegramId, true);
      return ctx.reply(
"📝 እባክዎ አዲስ USERNAME ይጻፉ (ቢያንስ 3 ፊደሎች)\nለመውጣት /cancel ይጻፉ።" );
    } catch (error) {
      if (error && error.msBeforeNext) {
        return ctx.reply("⚠️ Please wait a second before trying again.");
      }

      console.error(`❌ Error in /change_username command: ${error.message}`);
      return ctx.reply("🚫 An error occurred. Please try again later.");
    }
  });
};
