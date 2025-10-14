const User = require("../Model/user");
const { generateUniqueAccountNumber } = require("../utils/generateAccountNumber");
const { buildMainMenu } = require("../utils/menuMarkup");
const { userRateLimiter } = require("../Limit/global");

// --- Bonus System Configuration (Only referrer gets the bonus) ---
const REFERRER_BONUS = 0;   // The amount to credit the inviter (referrer)

module.exports = function (bot) {
    bot.on("contact", async (ctx) => {
        const telegramId = ctx.from.id;
        let referrerIdForErrorLogging = ctx.from.id; 

        // ⛔ Rate limit
        try {
            await userRateLimiter.consume(telegramId);
        } catch (rateErr) {
            return ctx.reply("⏳ Please wait before submitting again.");
        }

        // Find the user and check the registrationInProgress field
        const user = await User.findOne({ telegramId });
        
        // Safety check: Ensure the user is in the middle of registration
        if (!user || !user.registrationInProgress) {
            return ctx.reply("🚫 Please start the registration process by clicking the 'Register' button first.");
        }

        // Safety check: Prevent double registration if contact is resubmitted
        if (user.phoneNumber) {
            await ctx.reply("ℹ️ You are already registered and your phone number is saved.", buildMainMenu(user));
            return;
        }

        try {
            const phoneNumber = ctx.message.contact.phone_number;
            // Note: This account number generation utility must be defined in your project
            const accountNumber = await generateUniqueAccountNumber();

            // --- 1. Update the New User (Referee) Document to Complete Registration ---
            const updateFields = {
                username: ctx.from.first_name || "Guest",
                phoneNumber,
                // Clear the registrationInProgress field on completion
                $set: { registrationInProgress: null }
            };

            const updatedUser = await User.findOneAndUpdate(
                { telegramId },
                updateFields,
                { new: true, upsert: false }
            );

            // --- 2. Process Referral Payout (If a referrer exists) ---
            if (updatedUser.referrerId) {
                const referrerId = updatedUser.referrerId;
                referrerIdForErrorLogging = referrerId; 
                
                // Get the most identifiable name for the new user (referee)
                const refereeDisplayName = ctx.from.username 
                    ? `@${ctx.from.username}` 
                    : ctx.from.first_name || 'a new player';

                
                // Atomically update the referrer's count and bonus balance
                const referrerUpdateResult = await User.updateOne(
                    { telegramId: referrerId },
                    { 
                        $inc: { 
                            referralCount: 1, 
                            bonus_balance: REFERRER_BONUS 
                        } 
                    }
                );

                // Notify the referrer if the update was successful 
                if (referrerUpdateResult.modifiedCount > 0) {
                     // Fetch referrer's current data to get the updated count for the message
                     const referrerUser = await User.findOne({ telegramId: referrerId });

                     await bot.telegram.sendMessage(
                        referrerId,
                        `🥳 **Bonus Earned!** Your friend, ${refereeDisplayName}, has completed registration.\n\n` + 
                        `You have been credited **${REFERRER_BONUS} Birr** to your bonus balance.\nTotal successful referrals: **${referrerUser.referralCount}**`,
                        { parse_mode: 'Markdown' }
                    );
                    console.log(`[Referral Payout] Credited ${REFERRER_BONUS} Birr to referrer ${referrerId}`);
                }
            }

            // --- 3. Send Success Message to Referee (New User) ---
            await ctx.reply("✅ Your contact has been received.", {
                reply_markup: { remove_keyboard: true }
            });

            // Final registration message for the new user
            return ctx.reply(
                `🎉 Registration complete!\n` +
                (updatedUser.referrerId ? `_You joined via an invitation. Your inviter has now earned a **${REFERRER_BONUS} Birr** bonus._\n` : '') +
                `\nYour account number is: *${accountNumber}*`,
                {
                    ...buildMainMenu(updatedUser),
                    parse_mode: "Markdown"
                }
            );
        } catch (error) {
            console.error(`❌ Error during registration contact flow for user ${telegramId} (referrer: ${referrerIdForErrorLogging}):`, error);
            // Clear the state on error to prevent being stuck
            await User.findOneAndUpdate({ telegramId }, { registrationInProgress: null });
            return ctx.reply("🚫 Registration failed. Please try again.");
        }
    });
};
