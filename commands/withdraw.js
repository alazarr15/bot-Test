// commands/withdrawCommand.js
// This file handles the initial /withdraw command.

const User = require("../Model/user");
// ❌ REMOVED: const { userWithdrawalStates } = require("../handlers/state/withdrawalState");

const withdrawalBanks = [
    // { name: "🏛 CBE", code: "946" },
    { name: "📱 Telebirr", code: "855" }
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

            if (user.balance <= 0) {
                return ctx.reply("🚫 You do not have a positive balance to withdraw.");
            }

            // ✅ UPDATED: Initialize the withdrawal state directly in the database
            await User.findOneAndUpdate(
                { telegramId },
                {
                    withdrawalInProgress: {
                        step: "selectBank",
                        data: {},
                    }
                }
            );

            // Offer bank choices
            const keyboard = withdrawalBanks.map((bank) => [{
                text: bank.name,
                callback_data: `withdraw_${bank.code}`
            }]);

            return ctx.reply("💵 እባክዎ የገንዘብ ማውጣት ዘዴዎን ይምረጡ:", {
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