const User = require("../Model/user");
const { registrationInProgress } = require("../handlers/state/registrationState");
const { generateUniqueAccountNumber } = require("../utils/generateAccountNumber");
const { buildMainMenu } = require("../utils/menuMarkup");
const { userRateLimiter } = require("../Limit/global");


module.exports = function (bot) {
  bot.on("contact", async (ctx) => {
    const telegramId = ctx.from.id;
  // ⛔ Rate limit
    try {
      await userRateLimiter.consume(telegramId);
    } catch (rateErr) {
      return ctx.reply("⏳ Please wait before submitting again.");
    }
    if (!registrationInProgress[telegramId]) return;

    try {
      const phoneNumber = ctx.message.contact.phone_number;
      const accountNumber = await generateUniqueAccountNumber();

      const newUser = new User({
        telegramId,
        username: ctx.from.first_name || "Guest",
        accountNumber,
        phoneNumber
      });

      await newUser.save();
      delete registrationInProgress[telegramId];

      await ctx.reply("✅ Your contact has been received.", {
        reply_markup: { remove_keyboard: true }
      });

      return ctx.reply(
        `✅ Registration complete!\nYour account number is: *${accountNumber}*`,
        {
          ...buildMainMenu(newUser),
          parse_mode: "Markdown"
        }
      );
    } catch (error) {
      console.error("❌ Error during registration contact flow:", error);
      return ctx.reply("🚫 Registration failed. Please try again.");
    }
  });
};
