// handlers/manualDepositHandler.js

const User = require("../Model/user");
const SmsMessage = require("../Model/SmsMessage");
const Deposit = require("../Model/Deposit");
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");

// Helper: cancel any deposit flow
async function cancelDeposit(ctx, user) {
  await User.findByIdAndUpdate(user._id, { $set: { depositInProgress: { status: null, amount: null, method: null } } });
  await ctx.reply("❌ Manual deposit cancelled.");
}

// Handle messages (amount entry or SMS forwarding)
async function handleDepositMessage(ctx) {
  const user = await User.findOne({ telegramId: ctx.from.id });
  if (!user) return ctx.reply("🚫 User not found.");

  // Cancel flow
  if (ctx.message.text?.toLowerCase() === "/cancel") {
    return cancelDeposit(ctx, user);
  }

  const state = user.depositInProgress || {};

  try {
    if (!state.status) {
      // Step 1: Ask for amount
      await userRateLimiter.consume(ctx.from.id);
      await globalRateLimiter.consume("global");

      await ctx.reply("💰 ለማስገባት የሚፈልጉትን መጠን ያስገቡ: (ለመውጣት /cancel )");
      await User.findByIdAndUpdate(user._id, { $set: { "depositInProgress.status": "awaiting_amount" } });
      return;
    }

    if (state.status === "awaiting_amount") {
      const amount = parseFloat(ctx.message.text);
      if (isNaN(amount) || amount <= 0) {
        return ctx.reply("🚫 የተሳሳተ መጠን። እባክዎ ትክክለኛ ቁጥር ያስገቡ (ለምሳሌ፦ 100)። (ለመውጣት /cancel ይጻፉ)");
      }

      await User.findByIdAndUpdate(user._id, { $set: { "depositInProgress.status": "awaiting_method", "depositInProgress.amount": amount } });

      return ctx.reply(`💰 የሚፈልጉት ${amount} ብር ለማስገባት ነው። እባክዎ የክፍያ ዘዴዎን ይምረጡ:`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "CBE to CBE", callback_data: "payment_cbe" }],
            [{ text: "Telebirr To Telebirr", callback_data: "payment_telebirr" }],
          ],
        },
      });
    }

    if (state.status === "awaiting_sms") {
      const userMessage = ctx.message?.text || ctx.message?.caption;
      const claimedAmount = state.amount;

      if (!userMessage) return ctx.reply("❌ Please try forwarding the message again. (Type /cancel to exit)");

      const cbeRegex = /(FT[A-Z0-9]{10})/i;
      const telebirrRegex = /(?:transaction number is|የሂሳብ እንቅስቃሴ ቁጥርዎ|Lakkoofsi sochii maallaqaa keessan|ቁፅሪ ሒሳብ ዝተንቀሳቀሰ|lambarka hawulgalkaaguna waa)\s*([A-Z0-9]{10})\'?/i;

      let transactionId = null;
      const cbeMatch = userMessage.match(cbeRegex);
      const telebirrMatch = userMessage.match(telebirrRegex);

      if (cbeMatch && cbeMatch[1]) transactionId = cbeMatch[1];
      else if (telebirrMatch && telebirrMatch[1]) transactionId = telebirrMatch[1];

      if (!transactionId) return ctx.reply("🚫 መልእክት ትክክል አይደለም። ደግመው ይሞክሩ።");

      const matchingSms = await SmsMessage.findOne({
        status: "pending",
        $and: [
          { message: { $regex: new RegExp(transactionId, "i") } },
          { message: { $regex: new RegExp(claimedAmount.toFixed(2).replace(".", "\\."), "i") } },
        ],
      });

      if (!matchingSms) return ctx.reply("🚫 No matching deposit found. Check SMS and try again.");

      const balanceBefore = user.balance;
      const newBalance = balanceBefore + claimedAmount;

      await Deposit.create({
        userId: user._id,
        telegramId: user.telegramId,
        amount: claimedAmount,
        method: state.method,
        status: "approved",
        transactionId,
        smsMessageId: matchingSms._id,
        balanceBefore,
        balanceAfter: newBalance,
      });

      matchingSms.status = "processed";
      await matchingSms.save();

      await User.findByIdAndUpdate(user._id, {
        $inc: { balance: claimedAmount },
        $set: { depositInProgress: { status: null, amount: null, method: null } },
      });

      return ctx.reply(`✅ Your deposit of ${claimedAmount} ETB has been approved! New balance: *${newBalance} ETB*`, { parse_mode: "Markdown" });
    }
  } catch (error) {
    console.error("❌ Error processing deposit:", error);
    return ctx.reply("🚫 An error occurred. Please try again or contact support.");
  }
}

// Handle payment method selection (inline buttons)
async function handleDepositCallback(ctx) {
  const user = await User.findOne({ telegramId: ctx.from.id });
  if (!user) return ctx.reply("🚫 User not found.");

  const state = user.depositInProgress || {};
  if (!state.amount) return ctx.reply("🚫 Please enter the deposit amount first.");

  if (ctx.callbackQuery.data === "payment_cbe" || ctx.callbackQuery.data === "payment_telebirr") {
    const method = ctx.callbackQuery.data === "payment_cbe" ? "CBE" : "Telebirr";
    const amount = state.amount;

    let instructions = "";

    if (method === "CBE") {
      instructions = `
የኢትዮጵያ ንግድ ባንክ አካውንት

\`\`\`
1000454544246
\`\`\`

1. ከላይ ባለው አካውንት ${amount} ብር ያስገቡ
2. የምትልኩት የገንዘብ መጠን ተመሳሳይ መሆኑን እርግጠኛ ይሁኑ
3. ብሩን ስትልኩ ከባንክ የደረሰውን SMS ኮፒ ከታች ያስገቡ
4. ከUSSD (*889#) በመጨረሻ "Complete" ሲያሳይ ቁጥር ስትያዩ ጽፎ ይቀመጡ

🔔 ማሳሰቢያ:
- ካልደረሰዎት ደረሰኝ በባንክ ይፈትሹ
- የክፍያ ችግር ካለ [@luckybingos] ኤጀንቱን ይጠቀሙ

👉 SMS ወይም "FT" ብሎ የሚጀምረውን ቁጥር ያስገቡ 👇
`;
    } else {
      instructions = `
📱 የቴሌብር አካውንት

\`\`\`
0930534417
\`\`\`

1. ከላይ ባለው አካውንት ${amount} ብር ያስገቡ
2. የምትልኩት የገንዘብ መጠን ተመሳሳይ መሆኑን እርግጠኛ ይሁኑ
3. ብሩን ስትልኩ የቴሌብር የደረሰውን SMS ኮፒ ከታች ያስገቡ

🔔 ማሳሰቢያ:
- የክፍያ ችግር ካለ [@luckybingos] ኤጀንቱን ይጠቀሙ

👉 SMS ወይም "FT" ብሎ የሚጀምረውን ቁጥር ያስገቡ 👇
`;
    }

    // Update DB state
    await User.findByIdAndUpdate(user._id, { $set: { "depositInProgress.status": "awaiting_sms", "depositInProgress.method": method } });

    await ctx.answerCbQuery();
    return ctx.reply(instructions, { parse_mode: "Markdown" });
  }
}

module.exports = function (bot) {
  bot.on("message", handleDepositMessage);
  bot.on("callback_query", handleDepositCallback);
};
