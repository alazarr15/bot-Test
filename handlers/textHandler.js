const User = require("../Model/user");
const Transfer = require('../Model/transfer');
const { usernameChangeInProgress } = require("./state/usernameChangeState");
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");
const mongoose = require("mongoose");
const { registrationInProgress } = require("./state/registrationState"); // Ensure this is imported
const { userWithdrawalStates } = require("./state/withdrawalState"); // New import


// 🧩 Inline menu builder - This function is placed here as it's used within this module.
function buildMainMenu(user) {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: `✅ Registered as ${user?.username || "Guest"}`, callback_data: "registered" }],
        [{ text: "🎮 Play", callback_data: "Play" }],
        [
          { text: "💰 Check Balance", callback_data: "balance" },
          { text: "💳 Deposit", callback_data: "deposit" }
        ],
        [
          { text: "📞 Contact Support", callback_data: "support" },
          { text: "📖 Instruction", callback_data: "not_available" }
        ],
        [{ text: "📨 Invite", callback_data: "invite" }]
      ]
    }
  };
}

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

      // ⭐ UNIVERSAL CANCEL FOR SCENES (HIGHEST PRIORITY) ⭐
      // This checks if the user is in ANY Telegraf scene and types /cancel.
      if (message === "/cancel" || message === "cancel") {
        if (ctx.scene && ctx.scene.current && ctx.scene.current.id) {
          await ctx.reply("❌ Operation cancelled. You have exited the current flow.");
          return ctx.scene.leave(); // Explicitly exit the active scene
        } else if (usernameChangeInProgress.has(telegramId)) {
          // If not in a Telegraf Scene but in username change flow (custom state)
          usernameChangeInProgress.delete(telegramId);
          await ctx.reply("❌ Username change cancelled. You can start again with /change_username.");
          const user = await User.findOne({ telegramId });
          if (user) return ctx.reply("🔄 Main menu:", buildMainMenu(user));
          return;
        } else {
          // If not in a Telegraf Scene and no custom state is active, just acknowledge.
          return ctx.reply("👍 There is no active operation to cancel.");
        }
      }



        // ⭐ Check for a WITHDRAWAL flow first
      const userState = userWithdrawalStates.get(telegramId);
      if (userState) {
        // 💰 Handle amount input
        if (userState.step === "getAmount") {
          const amount = parseFloat(messageRaw);
          if (isNaN(amount) || amount <= 0) {
            return ctx.reply("🚫 That's an invalid amount. Please enter a positive number.");
          }
          if (amount > userState.userBalance) {
            return ctx.reply(`🚫 The amount you entered (${amount} ETB) is more than your balance (${userState.userBalance} ETB). Please enter a smaller amount.`);
          }
          userState.data.amount = amount;
          userState.step = "getAccount";
          return ctx.reply(`Please reply with your **${userState.data.bank_name}** account number:`, {
            parse_mode: 'Markdown'
          });
        }
        // 🔢 Handle account number input
        else if (userState.step === "getAccount") {
          const accountNumber = messageRaw;
          userState.data.account_number = accountNumber;
          userState.step = "confirm";
          const { bank_name, amount } = userState.data;
          const confirmMessage = `**Please confirm your withdrawal details:**\n- **Bank:** ${bank_name}\n- **Amount:** ${amount} ETB\n- **Account:** ${accountNumber}\n\nIs this correct?`;
          return ctx.reply(confirmMessage, {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: "✅ Confirm", callback_data: "withdraw_confirm" }],
                [{ text: "❌ Cancel", callback_data: "withdraw_cancel" }]
              ]
            }
          });
        }
        return; // Exit after processing the withdrawal flow
      }






      // === 1. Username Change Flow ===
      // This block runs if a username change is in progress and the message wasn't '/cancel'
      if (usernameChangeInProgress.has(telegramId)) {
        // Validation for new username
        if (messageRaw.length < 3) {
          return ctx.reply("⚠️ Invalid username. Please enter at least 3 characters.");
        }
        if (!/^[a-zA-Z0-9_]+$/.test(messageRaw)) {
          return ctx.reply("⚠️ Username can only contain letters, numbers, and underscores.");
        }

        const existingUser = await User.findOne({ username: messageRaw });
        if (existingUser && existingUser.telegramId !== telegramId) {
          return ctx.reply("🚫 This username is already taken. Please try a different one.");
        }

        // If all validations pass, update username and clean up state
        await User.updateOne({ telegramId }, { username: messageRaw });
        usernameChangeInProgress.delete(telegramId); // Clean up state upon successful change
        await ctx.reply(`✅ Your username has been updated to *${messageRaw}*!`, { parse_mode: "Markdown" });

        const user = await User.findOne({ telegramId });
        if (user) return ctx.reply("🔄 Main menu:", buildMainMenu(user));
        return; // End flow after successful username change
      }

      // === 2. Registration Check ===
      // This block prompts for registration if user sends text and isn't registered,
      // and not already in a registration flow.
      const user = await User.findOne({ telegramId });
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

          amount = Math.round(amount * 100) / 100; // Round to 2 decimals

          if (amount < 10 || amount > 1000) {
            return ctx.reply("🚫 Transfer amount must be between 10 and 1000 Birr.\n\nTo cancel, type /cancel.");
          }

          const session = await mongoose.startSession();
          session.startTransaction();

          try {
            const currentUser = await User.findOne({ telegramId: user.telegramId }).session(session);
            const recipient = await User.findOne({ phoneNumber: user.transferInProgress.recipient }).session(session);

            if (!recipient) {
              await session.abortTransaction();
              session.endSession();
              return ctx.reply("🚫 Unexpected error: Recipient not found. Transfer canceled.");
            }

            if (currentUser.balance < amount) {
              await session.abortTransaction();
              session.endSession();
              return ctx.reply("🚫 Insufficient balance. Transfer canceled.");
            }

            await User.updateOne({ telegramId: user.telegramId }, { $inc: { balance: -amount } }, { session });
            await User.updateOne({ phoneNumber: recipient.phoneNumber }, { $inc: { balance: amount } }, { session });

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

            await session.commitTransaction();
            session.endSession();

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

            await User.updateOne({ telegramId: user.telegramId }, { $unset: { transferInProgress: 1 } });
            return ctx.reply("🔄 Transfer complete. Returning to the main menu:", buildMainMenu(user));
          } catch (err) {
            await session.abortTransaction();
            session.endSession();
            console.error("❌ Transfer failed:", err);
            return ctx.reply("🚫 Transfer failed due to a server error. Please try again later.");
          }
        }
      } // End of transferInProgress block

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

