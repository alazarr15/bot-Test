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
        let settings; 

        try {
            // Fetch settings to determine bonus amounts and limit
            settings = await BonusSettings.findOne({ settingId: 'GLOBAL_BONUS_CONFIG' }); 
            
            if (settings) {
                // Prioritize DB values
                REFERRER_BONUS = settings.initiationBonus || 0; 
                REGISTRATION_BONUS = settings.registerationBonus || 0; 
            }

            // If the count is already >= limit, REGISTRATION_BONUS is 0, regardless of the DB 'registerationBonus' field.
            if (settings && settings.registrationBonusCount >= settings.registrationBonusLimit) {
                REGISTRATION_BONUS = 0; 
                console.log(`[Registration Bonus Check] Limit previously reached (${settings.registrationBonusCount}/${settings.registrationBonusLimit}). Bonus is 0.`);
            } else if (settings) {
                console.log(`[Registration Bonus Check] Promotion is active. Count: ${settings.registrationBonusCount}/${settings.registrationBonusLimit}, Bonus: ${REGISTRATION_BONUS}`);
            }
        } catch (dbErr) {
            console.error("Error fetching BonusSettings:", dbErr);
            // Default bonuses remain 0 on error
        }


        // Safety checks
        if (!user || !user.registrationInProgress) {
            return ctx.reply("🚫 Please start the registration process by clicking the 'Register' button first.");
        }
        if (user.phoneNumber) {
            await ctx.reply("ℹ️ You are already registered and your phone number is saved.", buildMainMenu(user));
            return;
        }

        try {
            const phoneNumber = ctx.message.contact.phone_number;
            const accountNumber = await generateUniqueAccountNumber();

            // Prepare the registration bonus increment ($inc) - Only applies if REGISTRATION_BONUS > 0
            const bonusInc = REGISTRATION_BONUS > 0
                ? { $inc: { bonus_balance: REGISTRATION_BONUS } } 
                : {};

            // Prepare the fields to SET ($set)
            const setFields = {
                username: ctx.from.first_name || "Guest",
                phoneNumber,
                registrationInProgress: null, // Clears the flag
                accountNumber: accountNumber,
            };

            const updateOperation = {
                $set: setFields, 
                ...bonusInc 
            };


            // --- 1. Update the New User (Referee) Document to Complete Registration and Apply Bonus ---
            const updatedUser = await User.findOneAndUpdate(
                { telegramId },
                updateOperation, 
                { new: true, upsert: false }
            );
            
            // --- BONUS LOGIC FOR NEW USER (REFEREE) - Simplified Approach ---
            if (REGISTRATION_BONUS > 0 && settings) {
                
                // Atomically increment the counter and get the updated document. 
                // We use findOneAndUpdate to get the result of the increment.
                const updatedSettings = await BonusSettings.findOneAndUpdate(
                    { settingId: 'GLOBAL_BONUS_CONFIG' },
                    { 
                        $inc: { registrationBonusCount: 1 } 
                    },
                    { new: true, upsert: false } // new:true returns the document *after* the increment
                );
                
                // Check if the counter was successfully updated and if the new count is <= the limit
                if (updatedSettings && updatedSettings.registrationBonusCount <= updatedSettings.registrationBonusLimit) {
                    
                    console.log(`[Registration Bonus] Credited ${REGISTRATION_BONUS} Birr to new user ${telegramId}. New Count: ${updatedSettings.registrationBonusCount}`);
                    
                    await ctx.reply(
                        `🎁 Congratulations, ${updatedUser.username}! You've received a **${REGISTRATION_BONUS} Birr** Free Trial Ticket bonus! This has been added to your **ቦነስ Balance**.`,
                        { parse_mode: 'Markdown' }
                    );

                    // --- CHECK AND ZERO OUT BONUS ---
                    // If the new count equals the limit, permanently set the bonus amount to 0 in the DB.
                    if (updatedSettings.registrationBonusCount === updatedSettings.registrationBonusLimit) {
                        await BonusSettings.updateOne(
                            { settingId: 'GLOBAL_BONUS_CONFIG' },
                            { $set: { registerationBonus: 0 } }
                        );
                        console.log(`[Registration Bonus] Limit reached (${updatedSettings.registrationBonusLimit}). Set 'registerationBonus' in DB to 0.`);
                    }
                    
                } else {
                    // This handles a failure or if the increment somehow pushed the count past the limit due to race condition 
                    // (which should be handled by the initial check, but this is the final safety net).
                    console.log(`[Registration Bonus] Counter update failed or count exceeded limit. Rolling back bonus.`);
                    
                    // Remove the bonus applied in step 1
                    await User.updateOne(
                        { telegramId },
                        { $inc: { bonus_balance: -REGISTRATION_BONUS } } 
                    );
                    console.log(`[Registration Bonus] Rolled back bonus of ${REGISTRATION_BONUS} Birr for user ${telegramId}.`);
                }

            } else {
                // This covers cases where REGISTRATION_BONUS was 0 because the limit was already hit 
                console.log(`[Registration Info] User ${telegramId} registered without bonus (Limit Check: ${settings ? settings.registrationBonusCount : 'N/A'}/${settings ? settings.registrationBonusLimit : 'N/A'}).`);
            }
            
            // --- 2. Process Referral Payout (If a referrer exists) ---
            if (updatedUser.referrerId) {
                const referrerId = updatedUser.referrerId;
                referrerIdForErrorLogging = referrerId; 
                
                const refereeDisplayName = ctx.from.username 
                    ? `@${ctx.from.username}` 
                    : ctx.from.first_name || 'a new player';

                
                // Atomically update the referrer's count and coin balance
                const referrerUpdateResult = await User.updateOne(
                    { telegramId: referrerId },
                    { 
                        $inc: { 
                            referralCount: 1, 
                            coin_balance: REFERRER_BONUS 
                        } 
                    }
                );
            
                if (referrerUpdateResult.modifiedCount > 0) {
                    const referrerUser = await User.findOne({ telegramId: referrerId });

                    let messageText = `🙏 Great job! The user ${refereeDisplayName} which u invite has successfully registered.`;

                    if (REFERRER_BONUS > 0) {
                        messageText += `\n\n💰 You have been credited **${REFERRER_BONUS} Birr** to your Coin Balance.`;
                    }
                    messageText += `\n\n**Main Balance:** *${referrerUser.balance || 0} ብር*`;
                    messageText += `\n**ቦነስ Balance:** *${referrerUser.bonus_balance || 0} ብር*`;
                    messageText += `\n**Coin Balance:** *${referrerUser.coin_balance || 0} ብር*`; 
                    
                    await bot.telegram.sendMessage(
                        referrerId,
                        messageText, 
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
                `🎉 Registration complete!\n` + `\nYour account number is: *${accountNumber}*`,
                {
                    ...buildMainMenu(updatedUser),
                    parse_mode: "Markdown"
                }
            );
        } catch (error) {
            console.error(`❌ Error during registration contact flow for user ${telegramId} (referrer: ${referrerIdForErrorLogging}):`, error);
            await User.findOneAndUpdate({ telegramId }, { registrationInProgress: null });
            return ctx.reply("🚫 Registration failed. Please try again.");
        }
    
    });
};