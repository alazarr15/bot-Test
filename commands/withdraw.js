// New file: commands/withdrawCommand.js

const User = require("../Model/user");
const { userWithdrawalStates } = require("../handlers/state/withdrawalState"); // We will create this file

const withdrawalBanks = [
  { name: "🏛 CBE", code: "946" },
  { name: "📱 Telebirr", code: "855" },
];

module.exports = function (bot) {
  bot.command("withdraw", async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      return ctx.reply("🚫 Could not verify your identity. Please try again.");
    }

    try {
      const user = await User.findOne({ telegramId });
      if (!user) {
        return ctx.reply("🚫 You must be registered to withdraw.");
      }

      // Check user's balance
      if (user.balance <= 0) {
        return ctx.reply("🚫 You do not have a positive balance to withdraw.");
      }

      // 💾 Initialize state for this user in our in-memory map
      userWithdrawalStates.set(telegramId, {
        step: "selectBank",
        userBalance: user.balance,
        data: {}, // To store bank_code, amount, account_number
      });

      // Offer bank choices
      const keyboard = withdrawalBanks.map((bank) => [{
        text: bank.name,
        callback_data: `withdraw_${bank.code}`
      }]);

      return ctx.reply("💵 Please choose your withdrawal method:", {
        reply_markup: {
          inline_keyboard: keyboard
        }
      });
    } catch (error) {
      console.error("❌ Error initiating /withdraw command for user:", telegramId, error);
      return ctx.reply("🚫 An error occurred. Please try again.");
    }
  });
};