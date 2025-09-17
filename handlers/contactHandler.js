const User = require("../Model/user");
// ❌ REMOVED: const { registrationInProgress } = require("../handlers/state/registrationState");
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

        // ✅ UPDATED: Find the user and check the registrationInProgress field
        const user = await User.findOne({ telegramId });
        if (!user || !user.registrationInProgress) {
            return ctx.reply("🚫 Please start the registration process by clicking the 'Register' button first.");
        }

        try {
            const phoneNumber = ctx.message.contact.phone_number;
            const accountNumber = await generateUniqueAccountNumber();

            // ✅ UPDATED: Instead of creating a new user, update the existing one
            // We find and update the document that was created when the user first clicked 'register'
            await User.findOneAndUpdate(
                { telegramId },
                {
                    username: ctx.from.first_name || "Guest",
                    phoneNumber,
                    // ✅ Clear the registrationInProgress field on completion
                    $set: { registrationInProgress: null }
                },
                { new: true, upsert: false } // upsert should be false here
            );

            // Re-fetch the updated user to get the latest data
            const updatedUser = await User.findOne({ telegramId });

            await ctx.reply("✅ Your contact has been received.", {
                reply_markup: { remove_keyboard: true }
            });

            return ctx.reply(
                `✅ Registration complete!\nYour account number is: *${accountNumber}*`,
                {
                    ...buildMainMenu(updatedUser),
                    parse_mode: "Markdown"
                }
            );
        } catch (error) {
            console.error("❌ Error during registration contact flow:", error);
            // ✅ UPDATED: Clear the state on error to prevent being stuck
            await User.findOneAndUpdate({ telegramId }, { registrationInProgress: null });
            return ctx.reply("🚫 Registration failed. Please try again.");
        }
    });
};