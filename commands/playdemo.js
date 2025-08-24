const User = require("../Model/user");
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");

module.exports = function (bot) {
  bot.command("playdemo", async (ctx) => {
    try {
      const telegramId = ctx.from.id;

         // ✅ Rate limit: 1 request per second per user
           await userRateLimiter.consume(telegramId);
     
           // ✅ Rate limit: 200 requests per second globally
           await globalRateLimiter.consume("global");

      const user = await User.findOne({ telegramId });

      if (!user) {
        return ctx.reply("🚫 You must register first. Please click below to register:", {
          reply_markup: {
            inline_keyboard: [[{ text: "🔐 Register", callback_data: "register" }]]
          }
        });
      }

    
    return ctx.reply("🎮 Choose your demo game:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "10 Birr", web_app: { url: `https://bossbingo.netlify.app/?user=${telegramId}&game=10` } }],
          [{ text: "20 Birr", web_app: { url: `https://bossbingo.netlify.app/?user=${telegramId}&game=20` } }],
          [{ text: "30 Birr", web_app: { url: `https://bossbingo.netlify.app/?user=${telegramId}&game=30` } }],
          [{ text: "40 Birr", web_app: { url: `https://bossbingo.netlify.app/?user=${telegramId}&game=40` } }]
        ]
      }
    });
    } catch (err) {
      if (err && err.msBeforeNext) {
        return ctx.reply("⚠️ Please wait a second before trying again.");
      }
      console.error("❌ Error in /playdemo command:", err.message);
      return ctx.reply("🚫 Failed to show demo options. Please try again later.");
    }
  });
};
