const User = require("../Model/user");
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");

module.exports = function (bot) {
  bot.command("play", async (ctx) => {
    try {
      const telegramId = ctx.from.id;

         // ✅ Rate limit: 1 request per second per user
           await userRateLimiter.consume(telegramId);
     
           // ✅ Rate limit: 200 requests per second globally
           await globalRateLimiter.consume("global");

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

    
    return ctx.reply("🎮 Choose your game:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "10 Birr", web_app: { url: `https://frontend.bingoogame.com/?user=${telegramId}&game=10` } }]
        ]
      }
    });
    } catch (err) {
      if (err && err.msBeforeNext) {
        return ctx.reply("⚠️ Please wait a second before trying again.");
      }
      console.error("❌ Error in /play command:", err.message);
      return ctx.reply("🚫 Failed to show game options. Please try again later.");
    }
  });
};
