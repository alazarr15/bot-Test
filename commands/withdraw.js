// commands/withdrawCommand.js

const User = require("../Model/user");
const Withdrawal = require("../Model/withdrawal");
const GameHistory = require("../Model/GameHistory");
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");
const { clearAllFlows } = require("../utils/flowUtils");


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
            // ✅ Apply rate limiting
            await Promise.all([
                userRateLimiter.consume(telegramId),
                globalRateLimiter.consume("global"),
            ]);

                const now = new Date();
                const currentHourUTC = now.getUTCHours(); // 0–23 UTC
                const WORK_START_UTC = 6; 
                const WORK_END_UTC = 21;   


                    if (currentHourUTC < WORK_START_UTC || currentHourUTC >= WORK_END_UTC) {
                        // This message is shown when the user attempts a withdrawal OUTSIDE of 9 AM to 12 AM EAT.
                        return ctx.reply(
                            "⏰ ገንዘብ ማውጣት የሚቻለው ከ*ጠዋት 3:00* እስከ *እኩለ ሌሊት 6:00* ብቻ ነዉ.\n" +
                            "🙏 እባክዎ በስራ ሰዓት ውስጥ ይሞክሩ።",
                            { parse_mode: "Markdown" }
                        );
                    }


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
            
            
            const winningGame = await GameHistory.findOne({
                telegramId: String(telegramId),
                eventType: 'win' // <-- Matches the 'eventType' field in your active schema
            });
            if (!winningGame) { // Check if a winning record was NOT found
                return ctx.reply("🚫 **Withdrawal Blocked:** You must win at least one game before you can withdraw any funds. Good luck!", { parse_mode: "Markdown" });
            }
            
            // --- NEW WITHDRAWAL CONDITION CHECK END ---
            
            // ✅ CORRECTED: Clear all other in-progress flows before starting this one.
            await clearAllFlows(telegramId);
            
            const MIN_WITHDRAWAL_AMOUNT = 100;
            if (user.balance < MIN_WITHDRAWAL_AMOUNT) {
                return ctx.reply(`🚫 Your balance must be at least *${MIN_WITHDRAWAL_AMOUNT} Birr* to withdraw. Your current balance is *${user.balance} Birr*.`, { parse_mode: "Markdown" });
            }
            
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const withdrawalCount = await Withdrawal.countDocuments({
                telegramId: String(telegramId),
                status: "completed",
                createdAt: { $gte: today }
            });
            
            const MAX_DAILY_WITHDRAWALS = 6;
            if (withdrawalCount >= MAX_DAILY_WITHDRAWALS) {
                return ctx.reply("🚫 You have reached your daily withdrawal limit. You can only withdraw up to 6 times per day.");
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

            return ctx.reply("💸 የገንዘብ ማውጣት ዘዴዎን ይምረጡ  👇", {
                reply_markup: {
                    inline_keyboard: keyboard
                }
            });
        } catch (error) {
            // If rate limiting failed, it throws an error that we catch here as well
            if (error.key) {
                // You may want to handle the rate limiting error specifically here, 
                // e.g., reply with a message about trying later.
                console.error("Rate limit hit for user:", telegramId);
                return ctx.reply("🛑 You are performing too many actions. Please try again shortly.");
            }
            
            console.error("❌ Error initiating /withdraw command for user:", telegramId, error);
            return ctx.reply("🚫 An error occurred. Please try again.");
        }
    });
};