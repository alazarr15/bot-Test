const User = require("../Model/user");
const Transfer = require('../Model/transfer');
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");
const mongoose = require("mongoose");
const { registrationInProgress } = require("./state/registrationState"); // Ensure this is imported
const SmsMessage = require("../Model/SmsMessage"); // Import your SMS message model
const Deposit = require("../Model/Deposit"); 
const redis = require("../utils/redisClient");
const { buildMainMenu } = require("../utils/menuMarkup");
const BonusSettings = require("../Model/BonusSettings");


module.exports = function (bot) {
    bot.on("text", async (ctx) => {
        try {
            const telegramId = ctx.from.id;
            const messageRaw = ctx.message.text.trim();
            const message = messageRaw.toLowerCase();

            // ✅ Apply rate limiting before processing ANY text message
            try {
                await Promise.all([
                    userRateLimiter.consume(telegramId),
                    globalRateLimiter.consume("global")
                ]);
            } catch (rateLimitErr) {
                console.warn("⚠️ Rate limit triggered for", telegramId);
                // ⭐ IMPORTANT: Use ctx.reply for text messages, not ctx.answerCbQuery
                return ctx.reply("⏳ Too many requests. Please wait a second.");
            }

            // ⭐ Fetch the user ONCE at the beginning of the handler
            const user = await User.findOne({ telegramId });

if (message === "/cancel" || message === "cancel") {
    // 1. If in a wizard/scene → leave
    if (ctx.scene && ctx.scene.current) {
        await ctx.scene.leave();
        await ctx.reply("❌ Operation cancelled. You have exited the current flow.");
        return;
    }

    // 2. Cancel deposit if active in DB
    if (user?.depositInProgress) {
        await User.updateOne(
            { telegramId },
            {
                $set: {
 depositInProgress: {
          step: null,
          amount: null,
          depositType: null,
          txId: null,
          timestamp: null
        }                }
            }
        );

        // Also reset session scratch if it exists
        if (ctx.session) {
            ctx.session.depositInProgress = null;
            if (ctx.wizard) ctx.wizard.state = {};
        }

        await ctx.reply("❌ Deposit request has been cancelled.");
        if (user) return ctx.reply("🔄 Main menu:", buildMainMenu(user));
        return;
    }

    // 3. Cancel username change
    if (user?.usernameChangeInProgress) {
        await User.updateOne(
            { telegramId },
            { $set: { usernameChangeInProgress: false } }
        );
        await ctx.reply("❌ Username change cancelled. You can start again with /change_username.");
        if (user) return ctx.reply("🔄 Main menu:", buildMainMenu(user));
        return;
    }

    // 4. Cancel transfer
    if (user?.transferInProgress) {
        await User.updateOne(
            { telegramId },
            { $unset: { transferInProgress: 1 } }
        );
        await ctx.reply("❌ Transfer cancelled. Returning to the main menu.", buildMainMenu(user));
        return;
    }

    // 5. Nothing active
    return ctx.reply("👍 There is no active operation to cancel.");
}


// From textHandler_v2.js
const depositState = user?.depositInProgress;
if (user && depositState) {
    if (depositState.step === "getAmount") {
        // Remove any non-numeric characters except dot, then parse
        const amount = parseFloat(messageRaw.replace(/[^0-9.]/g, '').trim());

        // Round to 2 decimal places
        const roundedAmount = Math.round(amount * 100) / 100;

        // Validate
        if (isNaN(roundedAmount) || roundedAmount < 30 || roundedAmount > 500) {
            return ctx.reply("🚫 የተሳሳተ መጠን። ማስገባት የሚችሉት መጠን ከ 30 እስከ 500 ብር ብቻ ነው፡፡ (ለማቋረጥ /cancel ይንኩ)");
        }

        // Update state to await payment method selection with the rounded amount
        await User.updateOne(
            { telegramId },
            { $set: { "depositInProgress.amount": roundedAmount, "depositInProgress.step": "selectMethod" } }
        );

        return ctx.reply(`💸 የሚፈልጉት ${roundedAmount} ብር ለማስገባት ነው ✅\n\n👇 እባክዎ የክፍያ ዘዴዎን ይምረጡ።\n\n🚫 ለመቋረጥ /cancel ይጻፉ።`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🏦 CBE → CBE", callback_data: "payment_cbe" }],
                    [{ text: "📱 Telebirr → Telebirr", callback_data: "payment_telebirr" }]
                ],
            },
        });
    }
}



// From textHandler_v2.js
if (depositState.step === "awaitingSMS") {
    const claimedAmount = depositState.amount;
    const depositType = depositState.depositType;
    const cbeRegex = /(FT[A-Z0-9]{10})/i;
    const telebirrRegex = /(?:transaction number is|የሂሳብ እንቅስቃሴ ቁጥርዎ|Lakkoofsi sochii maallaqaa keessan|ቁፅሪ ሒሳብ ዝተንቀሳቀሰ|lambarka hawulgalkaaguna waa)\s*([A-Z0-9]{10})\'?/i;
    let transactionId = null;

    if (depositType === 'CBE') {
        const cbeMatch = messageRaw.match(cbeRegex);
        if (cbeMatch) {
            transactionId = cbeMatch[1];
        }
    } else if (depositType === 'Telebirr') {
        const telebirrMatch = messageRaw.match(telebirrRegex);
        if (telebirrMatch) {
            transactionId = telebirrMatch[1];
        }
    }

    if (!transactionId) {
        return ctx.reply("🚫 የገለበጡት መልእክት ትክክለኛ የግብይት መለያ አልያዘም። እባክዎ ደግመው ይሞክሩ።");
    }

    // ⭐ STEP 1: Find the matching SMS message first.
    const matchingSms = await SmsMessage.findOne({
        status: "pending",
        $and: [
            { message: { $regex: new RegExp(transactionId, "i") } },
            { message: { $regex: new RegExp(claimedAmount.toFixed(2).replace('.', '\\.'), "i") } }
        ]
    });

    if (matchingSms) {
        // ⭐ STEP 2: Only if a match is found, start the transaction.
        const session = await mongoose.startSession();
        session.startTransaction();

        // --- BONUS CONFIGURATION START ---
        let BONUS_THRESHOLD = 50; // Birr (For standard cash bonus)
        let BONUS_AMOUNT = 0; // Birr (Standard cash bonus amount)
        let standardCashBonusToAward = 0;
        let initialTicketBonusToAward = 0; // 💡 NEW: The 1 free game ticket (coin)

        try {
            const settings = await BonusSettings.findOne({ settingId: 'GLOBAL_BONUS_CONFIG' });
            
            if (settings) {
                BONUS_THRESHOLD = settings.depositBonusThreshold || BONUS_THRESHOLD;
                BONUS_AMOUNT = settings.depositBonusAmount || BONUS_AMOUNT;
                // Use the hardcoded 1 ticket, or pull from settings if needed
                initialTicketBonusToAward = 1; 
            } else {
                initialTicketBonusToAward = 1; // Default to 1 ticket if no settings
            }
        } catch (dbErr) {
            console.error("Error fetching deposit bonus settings:", dbErr);
            initialTicketBonusToAward = 1; // Default to 1 ticket on error
        }

        // Check for the standard cash bonus logic
        if (claimedAmount >= BONUS_THRESHOLD) {
            standardCashBonusToAward = BONUS_AMOUNT; 
        }
        // --- BONUS CONFIGURATION END ---

        try {
            // Fetch the user BEFORE update to check registration time and bonus status
            const userBeforeUpdate = await User.findOne({ telegramId }).session(session);
            if (!userBeforeUpdate) {
                throw new Error("User not found during deposit processing.");
            }
            
            // 🛑 NEW 24-HOUR REGISTRATION BONUS LOGIC START 🛑
            let updateSet = { depositInProgress: null }; // Base update set for $set operator

            // Calculate the 24-hour mark from the user's registration date
            // Note: Your schema uses 'registeredAt'
            const registrationTime = userBeforeUpdate.registeredAt.getTime();
            const twentyFourHours = 24 * 60 * 60 * 1000;
            const twentyFourHourMark = registrationTime + twentyFourHours;
            
            let ticketBonus = 0; // Initialize ticket bonus for this transaction
            
            if (
                !userBeforeUpdate.initialDepositBonusClaimed && // Must not have claimed it before
                Date.now() < twentyFourHourMark // Must be within 24 hours of registration
            ) {
                ticketBonus = initialTicketBonusToAward; // Award the 1 free ticket
                // Set the flag to true so the bonus isn't given again
                updateSet.initialDepositBonusClaimed = true; 
            }
            // 🛑 NEW 24-HOUR REGISTRATION BONUS LOGIC END 🛑

            // Define the update for $inc
            let updateInc = {
                balance: claimedAmount, // Base deposit always goes to main balance
                bonus_balance: ticketBonus, // Add the new 1-time ticket bonus (if any)
            };
            
            // Add standard cash bonus to coin balance if criteria met (based on your original code)
           if (standardCashBonusToAward > 0) {
    updateInc.bonus_balance += standardCashBonusToAward;
}


            // ⭐ STEP 3: Update both the user and the SMS record atomically.
            const updatedUser = await User.findOneAndUpdate(
                { telegramId },
                { $inc: updateInc, $set: updateSet }, // Use the dynamically built $set and $inc
                { new: true, session }
            );

         if (updatedUser) {
                // 2. Update Redis with the new balance from the DB
                await redis.set(`userBalance:${telegramId}`, updatedUser.balance.toString(), { EX: 60 }); 
                await redis.set(`userBonusBalance:${telegramId}`, updatedUser.bonus_balance.toString(), { EX: 60 });
                await redis.set(`userCoinBalance:${telegramId}`, updatedUser.coin_balance.toString(), { EX: 60 });
            }

            // Update the status of the matching SMS message to prevent double-spending.
            await SmsMessage.updateOne(
                { _id: matchingSms._id },
                { $set: { status: "processed", processedBy: telegramId, processedAt: new Date() } },
                { session }
            );
            
            // Calculate total bonus awarded for the deposit record
            const totalBonusAwarded = standardCashBonusToAward + ticketBonus;
            
            // ⭐ NEW: Create the deposit record within the same transaction.
            await Deposit.create([{
                userId: updatedUser._id,
                telegramId: updatedUser.telegramId,
                amount: claimedAmount,
                method: depositType,
                status: 'approved',
                bonusAwarded: totalBonusAwarded, // <-- Track the total awarded bonus
                transactionId: transactionId,
                smsMessageId: matchingSms._id,
                balanceBefore: updatedUser.balance - claimedAmount,
                balanceAfter: updatedUser.balance,
            }], { session });

            // ⭐ STEP 4: Commit the changes if both updates were successful.
            await session.commitTransaction();
            session.endSession();

            // --- NEW SUCCESS MESSAGE START ---
            let successMessage = `🎉 ወደ አካውንትዎ ${claimedAmount} ETB ገቢ ሆኑአል፡፡`;

            if (standardCashBonusToAward > 0) {
                successMessage += `\n🎁 የ **${standardCashBonusToAward} ETB  ተጨማሪ ቦነስ አግኝተዋል**!`;
            }

            // 🛑 NEW success message for the 1-time ticket bonus 🛑
            if (ticketBonus > 0) {
                successMessage += `\n🎟️ እንኳን ደስ አለዎት! ለመጀመሪያ ጊዜ ተቀማጭ በማድረግዎ **${ticketBonus} ነጻ ትኬት** አግኝተዋል!`;
            }

            successMessage += `\n**Main Balance** is: *${updatedUser.balance} ብር*.`;
            successMessage += `\n**ቦነስ Balance** is: *${updatedUser.bonus_balance} ብር*.`;
            successMessage += `\n**Coin Balance** is: *${updatedUser.coin_balance} ብር*.`;
            
           // Send the success message first
return ctx.reply(successMessage, { parse_mode: 'Markdown' });


            // --- NEW SUCCESS MESSAGE END ---
            
        } catch (error) {
            // ⭐ STEP 5: Abort the transaction and handle errors.
            await session.abortTransaction();
            session.endSession();
            console.error("❌ Transaction failed during deposit processing:", error);

            // Reset the user's state and inform them.
            await User.updateOne({ telegramId }, { $set: { depositInProgress: null } });
            return ctx.reply("🚫 A server error occurred while processing your deposit. Please try again later.");
        }
    } else {
        // ⭐ Handle the case where no matching SMS was found.
        return ctx.reply("🚫 No matching deposit found. Please make sure you forwarded the correct and original confirmation message. If you believe this is an error, please contact support. (Type /cancel to exit)");
    }
}
            // ⭐ FIX 1: Use the `user` variable consistently.
            const userState = user?.withdrawalInProgress;

            if (user && userState) { // Check if the state exists in the DB
                // 💰 Handle amount input
                if (userState.step === "getAmount") {
                    let amount = parseFloat(messageRaw.replace(/[^0-9.]/g, '').trim()); // Clean up input first
                    amount = Math.round(amount * 100) / 100; // Round to 2 decimals  
                     const MIN_WITHDRAWAL_AMOUNT = 100;                  
                    if (isNaN(amount) || amount <= 0) {
                        return ctx.reply("🚫 የተሳሳተ መጠን ነው። እባክዎ አወንታዊ ቁጥር ያስገቡ።");
                    }

                     // <--- INSERT THE NEW MINIMUM CHECK HERE --->
                    if (amount < MIN_WITHDRAWAL_AMOUNT) { 
                        return ctx.reply(`🚫 ለማውጣት የሚችሉት ዝቅተኛው መጠን *${MIN_WITHDRAWAL_AMOUNT} ብር* ነው። እባክዎ የበለጠ መጠን ያስገቡ።`, { parse_mode: 'Markdown' });
                    }
                    // 

                    if (amount > user.balance) { // 👈 Use user.balance from the DB document
                        return ctx.reply(`🚫 ያስገቡት መጠን (${amount} ብር) ከቀሪ ሒሳብዎ (${user.balance} ብር) በላይ ነው። እባክዎ ያነሰ መጠን ያስገቡ።`);
                    }

                    // Update the state in the database
                    await User.updateOne({ telegramId }, {
                        $set: {
                            "withdrawalInProgress.data.amount": amount,
                            "withdrawalInProgress.step": "getAccount",
                        }
                    });

                    return ctx.reply(`እባክዎ የ**${userState.data.bank_name}** የሒሳብ ቁጥርዎን ይጻፉ።`, {
                        parse_mode: 'Markdown'
                    });
                }
                // 🔢 Handle account number input
                else if (userState.step === "getAccount") {
                    const accountNumber = messageRaw;
                    if (!/^\d{8,16}$/.test(accountNumber)) { // Allows 8 to 16 digits
                    return ctx.reply("🚫 የሒሳብ ቁጥሩ ትክክል አይመስልም። እባክዎ ከ8 እስከ 16 አሃዞች ያለውን ቁጥር በትክክል ያስገቡ።");
             }
                    // Update the state in the database
                    
                    await User.updateOne({ telegramId }, {
                        $set: {
                            "withdrawalInProgress.data.account_number": accountNumber,
                            "withdrawalInProgress.step": "confirm",
                        }
                    });

                    // Use the updated data to build the confirmation message
                    const { bank_name, amount } = userState.data;
                    const confirmMessage = `**የገንዘብ ማውጣት ዝርዝሮችዎን ያረጋግጡ:**\n- **ባንክ:** ${bank_name}\n- **መጠን:** ${amount} ብር\n- **የሒሳብ ቁጥር:** ${accountNumber}\n\nይህ ትክክል ነው?`;

                    return ctx.reply(confirmMessage, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: "✅ አረጋግጥ", callback_data: "withdraw_confirm" }],
                                [{ text: "❌ ይቅር", callback_data: "withdraw_cancel" }]
                            ]
                        }
                    });
                }
                return;
            }

            // ✅ UPDATED: The condition now checks the database field
            if (user?.usernameChangeInProgress) {
                // Validation for new username
                if (messageRaw.length < 3) {
                    return ctx.reply("⚠️ የተሳሳተ USERNAME እባክዎ ቢያንስ 3 ፊደሎች ያስገቡ።");
                }
                if (!/^[a-zA-Z0-9_]+$/.test(messageRaw)) {
                    return ctx.reply("⚠️ USERNAME ፊደል፣ ቁጥር እና \"_\" ብቻ ሊይዝ ይችላል።");
                }

                const existingUser = await User.findOne({ username: messageRaw });
                if (existingUser && existingUser.telegramId !== telegramId) {
                    return ctx.reply("🚫 ይህ USERNAME ቀድሞውኑ ተይዟል። እባክዎ ሌላ ይሞክሩ።");
                }

                // If all validations pass, update username and clean up state
                // ✅ UPDATED: The database is updated to set the new username AND clear the state
                await User.updateOne({ telegramId }, { $set: { username: messageRaw, usernameChangeInProgress: false } });

                await ctx.reply(`✅ USERNAMEዎ ወደ *${messageRaw}* ተቀይሯል!`, { parse_mode: "Markdown" });

                if (user) return ctx.reply("🔄 ዋና መዝገብ:", buildMainMenu(user));
                return; // End flow after successful username change
            }

            // === 2. Registration Check ===
            // This block prompts for registration if user sends text and isn't registered,
            // and not already in a registration flow.
            if (!user) {
                if (!registrationInProgress[telegramId]) { // Only prompt if not already in registration
                    registrationInProgress[telegramId] = { step: 1 };
                    return ctx.reply(
                        "👋 Welcome! Please register first to access the demo. Click the button below to register.",
                        {
                            reply_markup: {
                                inline_keyboard: [[{ text: "🔐 Register", callback_data: "register" }]]
                            }
                        }
                    );
                }
                // If already in registrationInProgress, and the message wasn't a command,
                // let other handlers (like contactHandler) process it, or simply do nothing here.
                return; // Don't fall through to other general text handlers if registration is pending.
            }

            // === 3. Transfer Flow ===
            // This block executes if a transfer is in progress and message wasn't '/cancel' (handled above)
          if (user.transferInProgress) {
  // --- STEP 1: Recipient ---
  if (user.transferInProgress.step === 1) {
    let recipientPhoneNumber = messageRaw.replace(/\s+/g, "");

    if (recipientPhoneNumber.startsWith("0")) {
      recipientPhoneNumber = "251" + recipientPhoneNumber.slice(1);
    }

    if (!/^\d{12}$/.test(recipientPhoneNumber)) {
      return ctx.reply("🚫 Invalid phone number format. Please enter a 12-digit number including country code.");
    }

    const recipient = await User.findOne({ phoneNumber: recipientPhoneNumber });
    if (!recipient) {
      return ctx.reply("🚫 Recipient not found. Please check the phone number.\n\nTo cancel, type /cancel.");
    }

    if (recipient._id.equals(user._id)) {
      return ctx.reply("🚫 You cannot transfer to yourself. Please enter a different recipient.\n\nTo cancel, type /cancel.");
    }

    await User.updateOne(
      { telegramId },
      { $set: { "transferInProgress.recipient": recipientPhoneNumber, "transferInProgress.step": 2 } }
    );

    return ctx.reply("💵 Enter the amount you wish to transfer:");
  }

  // --- STEP 2: Amount ---
  if (user.transferInProgress.step === 2) {
    let amount = parseFloat(messageRaw);

    if (isNaN(amount) || amount <= 0) {
      return ctx.reply("🚫 Invalid amount. Please enter a valid number.\n\nTo cancel, type /cancel.");
    }

    amount = Math.round(amount * 100) / 100;

    if (amount < 30 || amount > 1000) {
      return ctx.reply("🚫 Transfer amount must be between 30 and 1000 Birr.\n\nTo cancel, type /cancel.");
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const recipient = await User.findOne({ phoneNumber: user.transferInProgress.recipient }).session(session);

      if (!recipient) {
        await session.abortTransaction();
        session.endSession();
        return ctx.reply("🚫 Unexpected error: Recipient not found. Transfer canceled.");
      }

      if (user.balance < amount) {
        await session.abortTransaction();
        session.endSession();
        return ctx.reply("🚫 Insufficient balance. Transfer canceled.");
      }

      // --- Update both balances in MongoDB within the transaction ---
      await User.updateOne({ telegramId: user.telegramId }, { $inc: { balance: -amount } }, { session });
      await User.updateOne({ phoneNumber: recipient.phoneNumber }, { $inc: { balance: amount } }, { session });

      // --- Record transfer ---
      const transferRecord = new Transfer({
        senderId: user._id,
        recipientId: recipient._id,
        senderPhone: user.phoneNumber,
        recipientPhone: recipient.phoneNumber,
        senderTelegramId: user.telegramId,
        recipientTelegramId: recipient.telegramId || null,
        amount: amount,
      });
      await transferRecord.save({ session });

      // ✅ Commit the transaction
      await session.commitTransaction();
      session.endSession();

      // ✅ Fetch fresh data for Redis sync (both sender and recipient)
      const updatedUser = await User.findOne({ telegramId });
      const updatedRecipient = await User.findOne({ phoneNumber: recipient.phoneNumber });

      // ✅ Update Redis for sender (balance + bonus)
      await redis.set(`userBalance:${telegramId}`, updatedUser.balance.toString(), { EX: 60 });
      await redis.set(`userBonusBalance:${telegramId}`, (updatedUser.bonus_balance || 0).toString(), { EX: 60 });

      // ✅ Update Redis for recipient (balance + bonus, if telegramId exists)
      if (updatedRecipient.telegramId) {
        await redis.set(`userBalance:${updatedRecipient.telegramId}`, updatedRecipient.balance.toString(), { EX: 60 });
        await redis.set(`userBonusBalance:${updatedRecipient.telegramId}`, (updatedRecipient.bonus_balance || 0).toString(), { EX: 60 });
      }

      // ✅ Notify both parties
      await ctx.reply(`✅ Transferred **${amount} Birr** to phone number **${recipient.phoneNumber}**.`);

      if (recipient.telegramId) {
        try {
          await ctx.telegram.sendMessage(
            recipient.telegramId,
            `✅ You received **${amount} Birr** from phone number **${user.phoneNumber}**.`
          );
        } catch (err) {
          console.warn("⚠️ Failed to notify recipient:", err.message);
        }
      }

      // ✅ Reset transfer progress
      await User.updateOne({ telegramId: user.telegramId }, { $unset: { transferInProgress: 1 } });

      return ctx.reply("🔄 Transfer complete. Returning to the main menu:", buildMainMenu(user));
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      console.error("❌ Transfer failed:", err);
      return ctx.reply("🚫 Transfer failed due to a server error. Please try again later.");
    }
  }
}

            // === 4. Main Menu Fallback ===
            // This is the general fallback if no other specific flow handles the message.
            // It checks for explicit commands that should return to the main menu.
            if (message.startsWith('/') || ["/Play", "/balance", "/deposit", "/start"].includes(message)) {
                // Commands are typically handled by bot.command() listeners,
                // but if they fall through to text handler, this sends main menu.
                // The /start command in particular often leads back to the main menu.
                return ctx.reply("🔄 Returning to the main menu.", buildMainMenu(user));
            } else {
                // ⭐ Fallback for any unhandled text when no scene or custom state is active.
                return ctx.reply("😕 I didn't understand that. Please use the menu buttons or available commands.");
            }

        } catch (error) {
            console.error("❌ ERROR in bot text handler:", error.message);
            ctx.reply("🚫 An error occurred. Please try again.");
        }
    });
};