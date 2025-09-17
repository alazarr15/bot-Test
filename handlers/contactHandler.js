const User = require("../Model/user");
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

    // ✅ Find the user and check the registrationInProgress field
    const user = await User.findOne({ telegramId });
    if (!user || !user.registrationInProgress) {
      return ctx.reply("🚫 Please start the registration process by clicking the 'Register' button first.");
    }

    try {
      const phoneNumber = ctx.message.contact.phone_number;
      const accountNumber = await generateUniqueAccountNumber();
      const newBonusAmount = 10; // Bonus for the new user
      const referralBonusAmount = 2; // Bonus for the inviter

      // ✅ Update the existing user document with registration details
      const updatedUser = await User.findOneAndUpdate(
        { telegramId },
        {
          username: ctx.from.first_name || "Guest",
          phoneNumber,
          bonus_balance: newBonusAmount,
          $set: { registrationInProgress: null },
        },
        { new: true, upsert: false }
      );

      // ⭐ New: Check if the user has a referrer and process the referral bonus
      if (updatedUser.referrerId) {
        const referrerId = updatedUser.referrerId;
        console.log(`User ${telegramId} was referred by user ${referrerId}`);

        // Give the referrer their bonus and increment their referral count
        const referrer = await User.findOneAndUpdate(
          { telegramId: referrerId },
          { 
            $inc: { 
              bonus_balance: referralBonusAmount, 
              referralCount: 1 
            }
          },
          { new: true } // Return the updated referrer document
        );

        if (referrer) {
          // Notify the referrer about the new referral bonus
          try {
            await bot.telegram.sendMessage(
              referrerId,
              `🎉 Referral Bonus! A new user you invited has successfully registered. You have been awarded **${referralBonusAmount} Birr** in your bonus balance.`,
              { parse_mode: "Markdown" }
            );
          } catch (notificationError) {
            console.error(`❌ Could not notify referrer ${referrerId}:`, notificationError.message);
            // Don't fail the main process if notification fails
          }
        }
      }

      await ctx.reply("✅ Your contact has been received.", {
        reply_markup: { remove_keyboard: true },
      });

      return ctx.reply(
        `✅ Registration complete! You have received a **${newBonusAmount} Birr** bonus.\nYour account number is: *${accountNumber}*`,
        {
          ...buildMainMenu(updatedUser),
          parse_mode: "Markdown",
        }
      );
    } catch (error) {
      console.error("❌ Error during registration contact flow:", error);
      await User.findOneAndUpdate({ telegramId }, { registrationInProgress: null });
      return ctx.reply("🚫 Registration failed. Please try again.");
    }
  });
};