const User = require("../Model/user");
const { generateUniqueAccountNumber } = require("../utils/generateAccountNumber");
const { buildMainMenu } = require("../utils/menuMarkup");
const { userRateLimiter } = require("../Limit/global");
const BonusSettings = require("../Model/BonusSettings");

// --- Bonus System Configuration (Only referrer gets the bonus) ---

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
        
 let REFERRER_BONUS = 0; 
 let REGISTRATION_BONUS = 0;
        try {
            const settings = await BonusSettings.findOne({ settingId: 'GLOBAL_BONUS_CONFIG' });
            if (settings) {
                // Existing: Invitation Bonus for the Referrer
                REFERRER_BONUS = settings.initiationBonus || 0; 
                // 🚀 New: Registration Bonus for the New User (Referee)
                REGISTRATION_BONUS = settings.registerationBonus || 0; 
            }
        } catch (dbErr) {
            console.error("Error fetching initiationBonus for referral:", dbErr);
            // Default REFERRER_BONUS remains 0 on error
        }


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

           // Prepare the registration bonus increment ($inc)
           const bonusInc = REGISTRATION_BONUS > 0
                ? { $inc: { bonus_balance: REGISTRATION_BONUS } } 
                : {};

            // Prepare the fields to SET ($set)
            const setFields = {
                username: ctx.from.first_name || "Guest",
                phoneNumber,
                registrationInProgress: null, // Clears the flag
            };

            // Combine $set and $inc for an atomic database operation
            const updateOperation = {
                $set: setFields, 
                ...bonusInc 
            };


            // --- 1. Update the New User (Referee) Document to Complete Registration and Apply Bonus ---
            const updatedUser = await User.findOneAndUpdate(
                { telegramId },
                updateOperation, // This is the fix! It applies both the phone number and the bonus.
                { new: true, upsert: false }
            );
             
           if (REGISTRATION_BONUS > 0) {
                console.log(`[Registration Bonus] Credited ${REGISTRATION_BONUS} Birr to new user ${telegramId}`);
                await ctx.reply(
                    `🎁 Congratulations, ${updatedUser.username}! You've received a **${REGISTRATION_BONUS} Birr** registration bonus! This has been added to your **ቦነስ Balance**.`,
                    { parse_mode: 'Markdown' }
                );
            }
  
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
                              coin_balance: REFERRER_BONUS 
                        } 
                    }
                );

                // Notify the referrer if the update was successful 
           
  if (referrerUpdateResult.modifiedCount > 0) {
    // Re-fetch referrer's data to get the LATEST balances
    const referrerUser = await User.findOne({ telegramId: referrerId });

    // Determine the base congratulation message
    let messageText = `🙏 Great job!The user ${refereeDisplayName} which u invite  has successfully registered.`;

    // --- CONDITIONALLY ADD BONUS AND BALANCE DETAILS ---
    if (REFERRER_BONUS > 0) {
        // If a bonus was awarded, add the bonus message and ALL balance details
        messageText += `\n\n💰 You have been credited **${REFERRER_BONUS} Birr** to your Coin Balance.`;
        messageText += `\n\n**Main Balance:** *${referrerUser.balance || 0} ብር*`;
        messageText += `\n**ቦነስ Balance:** *${referrerUser.bonus_balance || 0} ብር*`;
        messageText += `\n**Coin Balance:** *${referrerUser.coin_balance || 0} ብር*`; 
    } 
    await bot.telegram.sendMessage(
        referrerId,
        messageText, 
        { parse_mode: 'Markdown' }
    );
    
    // Keep the logging regardless of bonus amount
    console.log(`[Referral Payout] Credited ${REFERRER_BONUS} Birr to referrer ${referrerId}`);
}
// ...
            }

            // --- 3. Send Success Message to Referee (New User) ---
            await ctx.reply("✅ Your contact has been received.", {
                reply_markup: { remove_keyboard: true }
            });

            // Final registration message for the new user
            return ctx.reply(
                `🎉 Registration complete!\n` + `\nYour account number is: *${accountNumber}*`,
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
