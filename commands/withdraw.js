// commands/withdrawCommand.js
// This file handles the initial /withdraw command.

const User = require("../Model/user");
const Withdrawal = require("../Model/withdrawal"); // ❗ You need to import the Withdrawal model

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

            // ✅ NEW: Check if balance is at least 50 Birr
            const MIN_WITHDRAWAL_AMOUNT = 50;
            if (user.balance < MIN_WITHDRAWAL_AMOUNT) {
                return ctx.reply(`🚫 Your balance must be at least *${MIN_WITHDRAWAL_AMOUNT} Birr* to withdraw. Your current balance is *${user.balance} Birr*.`, { parse_mode: "Markdown" });
            }

            // ✅ NEW: Check daily withdrawal count
            const today = new Date();
            today.setHours(0, 0, 0, 0); // Reset to start of the day
            const withdrawalCount = await Withdrawal.countDocuments({
                telegramId: String(telegramId),
                status: "completed",
                createdAt: { $gte: today }
            });
            
            const MAX_DAILY_WITHDRAWALS = 2;
            if (withdrawalCount >= MAX_DAILY_WITHDRAWALS) {
                return ctx.reply("🚫 You have reached your daily withdrawal limit. You can only withdraw up to 2 times per day.");
            }

            // Initialize the withdrawal state in the database
            await User.findOneAndUpdate(
                { telegramId },
                {
                    withdrawalInProgress: {
                        step: "selectBank",
                        data: {},
                    }
                }
            );

            const keyboard = withdrawalBanks.map((bank) => [{
                text: bank.name,
                callback_data: `withdraw_${bank.code}`
            }]);

            return ctx.reply("💵 የገንዘብ ማውጣት ዘዴዎን ይምረጡ:", {
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